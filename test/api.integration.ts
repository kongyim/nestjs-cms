import "reflect-metadata";
import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import { DataSource } from "typeorm";
import request from "supertest";
import { randomUUID } from "node:crypto";
import {
  S3Client,
  HeadObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { AppModule } from "../src/app.module";
import { dataSource } from "../src/database/data-source";
import { config } from "../src/config";
import { ResourceService } from "../src/resource/resource.service";
import { ResourceRegistry } from "../src/resource/resource.registry";
import { AttachmentEntity } from "../src/storage/attachment.entity";
import { S3Service } from "../src/storage/s3.service";
import { AttachmentService } from "../src/storage/attachment.service";

let app: INestApplication;
let db: DataSource;
let articleId: string;
let categoryId: string;
let coverId: string;
const prefix = `test-${randomUUID()}`;
const extraIds: string[] = [];
const s3 = new S3Client({
  endpoint: config.S3_ENDPOINT,
  region: config.S3_REGION,
  forcePathStyle: true,
  credentials: {
    accessKeyId: config.S3_ACCESS_KEY_ID!,
    secretAccessKey: config.S3_SECRET_ACCESS_KEY!,
  },
  requestChecksumCalculation: "WHEN_REQUIRED",
});
const api = () => request(app.getHttpServer());
const auth = { "X-API-Key": config.ADMIN_API_KEY };
const file = Buffer.from("integration file content");
const upload = async (
  field = "cover",
  name = "test.png",
  type = "image/png",
) => {
  const response = await api()
    .post(`/api/articles/${articleId}/attachments/${field}`)
    .set(auth)
    .attach("file", file, { filename: name, contentType: type })
    .expect(201);
  expect(response.body.url).toBeUndefined();
  expect(response.body.key).toBeUndefined();
  return response.body;
};

beforeAll(async () => {
  if (config.DB_DATABASE !== "cms_test")
    throw new Error("Tests require dedicated cms_test database");
  await dataSource.initialize();
  await dataSource.runMigrations();
  const module = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  app = module.createNestApplication();
  await app.init();
  db = app.get(DataSource);
});
afterAll(async () => {
  if (db?.isInitialized) {
    const ids = [articleId, ...extraIds].filter(Boolean);
    const attachments = await db.getRepository(AttachmentEntity).find();
    for (const attachment of attachments.filter((a) =>
      ids.includes(a.recordId),
    )) {
      await s3.send(
        new DeleteObjectCommand({
          Bucket: config.S3_BUCKET,
          Key: attachment.key,
        }),
      );
      if (attachment.stagingKey)
        await s3.send(
          new DeleteObjectCommand({
            Bucket: config.S3_BUCKET,
            Key: attachment.stagingKey,
          }),
        );
      await db.getRepository(AttachmentEntity).delete(attachment.id);
    }
    for (const id of ids) await db.getRepository("articles").delete({ id });
    if (categoryId)
      await db.getRepository("categories").delete({ id: categoryId });
  }
  s3.destroy();
  if (app) await app.close();
  else if (dataSource.isInitialized) await dataSource.destroy();
});

it("requires API key and exposes schema discovery", async () => {
  await api().get("/api/_resources").expect(401);
  const res = await api().get("/api/_resources").set(auth).expect(200);
  expect(res.body.map((r: { name: string }) => r.name)).toEqual([
    "articles",
    "categories",
  ]);
});
it("creates records with defaults, validates payloads and maps unique conflicts", async () => {
  const category = await api()
    .post("/api/categories")
    .set(auth)
    .send({ slug: prefix, name: { en: "News", tc: "消息" } })
    .expect(201);
  categoryId = category.body.id;
  const created = await api()
    .post("/api/articles")
    .set(auth)
    .send({ slug: prefix, title: "Original", categoryId, status: "published" })
    .expect(201);
  articleId = created.body.id;
  expect(created.body.body).toBe("");
  expect(created.body.cover).toBeNull();
  await api()
    .post("/api/articles")
    .set(auth)
    .send({ slug: prefix, title: "Duplicate" })
    .expect(409);
  await api()
    .post("/api/articles")
    .set(auth)
    .send({ title: "", slug: "bad", extra: true })
    .expect(400);
  await api()
    .post("/api/articles")
    .set(auth)
    .send({
      title: "Bad category",
      slug: `${prefix}-bad`,
      categoryId: randomUUID(),
    })
    .expect(400);
  await api().delete(`/api/categories/${categoryId}`).set(auth).expect(409);
});
it("patches without resetting defaults and provides filtering, stable sorting and bounded pagination", async () => {
  const patched = await api()
    .patch(`/api/articles/${articleId}`)
    .set(auth)
    .send({ title: "Changed 100%_value" })
    .expect(200);
  expect(patched.body.status).toBe("published");
  expect(patched.body.categoryId).toBe(categoryId);
  const list = await api()
    .get("/api/articles")
    .set(auth)
    .query({
      query: JSON.stringify({ slug: prefix, title: { $contains: "100%_" } }),
      sort: "title:asc",
      limit: 1,
    })
    .expect(200);
  expect(list.body.meta.total).toBe(1);
  expect(list.body.data[0].id).toBe(articleId);
  await api()
    .get("/api/articles")
    .set(auth)
    .query({ limit: "all" })
    .expect(400);
  await api()
    .get("/api/articles")
    .set(auth)
    .query({ query: '{"title":{"raw":"1=1"}}' })
    .expect(400);
  await api().get("/api/articles/not-a-uuid").set(auth).expect(400);
  await api().get("/api/no_such_resource").set(auth).expect(404);
  await api().get(`/api/articles/${randomUUID()}`).set(auth).expect(404);
});
it("supports dollar operators and SQL substring positions without exposing SQL", async () => {
  const match = async (filter: unknown, total: number) => {
    const result = await api()
      .get("/api/articles")
      .set(auth)
      .query({
        query: JSON.stringify({ slug: { $eq: prefix }, ...(filter as object) }),
      })
      .expect(200);
    expect(result.body.meta.total).toBe(total);
  };
  await match({ status: { $in: ["published", "archived"] } }, 1);
  await match(
    {
      title: {
        $gt: "A",
        $gte: "Changed 100%_value",
        $lt: "Z",
        $lte: "Changed 100%_value",
      },
    },
    1,
  );
  await match({ title: { $locate: "100%_" } }, 1);
  await match({ title: { $locate: { search: "100%_" } } }, 1);
  await match({ title: { $locate: { search: "100%_", $eq: 9 } } }, 1);
  await match(
    {
      title: {
        $locate: { search: "100%_", $gt: 8, $gte: 9, $lt: 10, $lte: 9 },
      },
    },
    1,
  );
  await match({ title: { $locate: { search: "missing", $eq: 0 } } }, 1);
  await match({ title: { $locate: "missing" } }, 0);
  await match({ title: { $locate: { search: "missing" } } }, 0);
  await match({ title: { $locate: { search: "missing", $lte: 0 } } }, 1);
  await match({ title: { $locate: "' OR 1=1 --" } }, 0);
  await match({ categoryId: { $eq: null } }, 0);
  for (const title of [
    { contains: "100" },
    { $contians: "100" },
    { $locate: { search: "100", $eq: -1 } },
    { $locate: { search: "100", $eq: 1.5 } },
    { $locate: { search: "" } },
    { $locate: "" },
  ]) {
    await api()
      .get("/api/articles")
      .set(auth)
      .query({ query: JSON.stringify({ title }) })
      .expect(400);
  }
});
it("runs hooks sequentially and rolls back database changes when an after hook fails", async () => {
  const def = app.get(ResourceRegistry).get("articles");
  const original = def.hooks;
  const events: string[] = [];
  try {
    def.hooks = {
      ...original,
      onBeforeCreate: [
        ({ record }) => {
          events.push("before");
          return { ...record, title: "hook title" };
        },
      ],
      onAfterCreate: [
        async ({ manager, record }) => {
          events.push(String(record.title));
          await manager
            .getRepository("categories")
            .update({ id: categoryId }, { status: "inactive" });
          throw new Error("deliberate rollback");
        },
      ],
    };
    await api()
      .post("/api/articles")
      .set(auth)
      .send({ slug: `${prefix}-rollback`, title: "input" })
      .expect(500);
    expect(events).toEqual(["before", "hook title"]);
    expect(
      await db
        .getRepository("articles")
        .countBy({ slug: `${prefix}-rollback` }),
    ).toBe(0);
    expect(
      (await db.getRepository("categories").findOneByOrFail({ id: categoryId }))
        .status,
    ).toBe("active");
  } finally {
    def.hooks = original;
  }
});
it("uploads and streams bytes only through the authenticated attachment API", async () => {
  const uploaded = await upload();
  coverId = uploaded.id;
  expect(uploaded.size).toBe(file.length);
  const storageRead = jest.spyOn(app.get(S3Service), "download");
  try {
    const metadata = await app
      .get(ResourceService)
      .findAttachment("articles", articleId, "cover", coverId);
    expect(metadata.id).toBe(coverId);
    expect(metadata.size).toBe(file.length);
    expect(Object.keys(metadata).sort()).toEqual([
      "createdAt",
      "id",
      "mimeType",
      "name",
      "size",
    ]);
    expect(storageRead).not.toHaveBeenCalled();
  } finally {
    storageRead.mockRestore();
  }
  await expect(
    app
      .get(ResourceService)
      .findAttachment("articles", articleId, "cover", randomUUID()),
  ).rejects.toMatchObject({ status: 404 });
  const record = await api()
    .get(`/api/articles/${articleId}`)
    .set(auth)
    .expect(200);
  expect(record.body.cover.id).toBe(coverId);
  const path = `/api/articles/${articleId}/attachments/cover/${coverId}`;
  await api().get(path).expect(401);
  const downloaded = await api().get(path).set(auth).expect(200);
  expect(downloaded.body).toEqual(file);
  expect(downloaded.headers["content-type"]).toBe("image/png");
  expect(Number(downloaded.headers["content-length"])).toBe(file.length);
  expect(downloaded.headers["content-disposition"]).toContain("attachment;");
  expect(downloaded.headers["cache-control"]).toBe("private, no-store");
  expect(downloaded.headers.location).toBeUndefined();
  await api()
    .post(`/api/articles/${articleId}/attachments/cover/uploads`)
    .set(auth)
    .send({})
    .expect(404);
  await api().post(`${path}/complete`).set(auth).send({}).expect(404);
});
it("rejects missing files, wrong fields, MIME types, excessive sizes and cross-record downloads", async () => {
  const base = `/api/articles/${articleId}/attachments`;
  await api().post(`${base}/cover`).set(auth).send({}).expect(400);
  await api()
    .post(`${base}/cover`)
    .set(auth)
    .attach("wrong", file, "test.png")
    .expect(400);
  await api()
    .post(`${base}/cover`)
    .set(auth)
    .attach("file", file, { filename: "x.html", contentType: "text/html" })
    .expect(400);
  await api()
    .post(`${base}/cover`)
    .set(auth)
    .attach("file", Buffer.alloc(0), {
      filename: "x.png",
      contentType: "image/png",
    })
    .expect(400);
  await api()
    .post(`${base}/invalid`)
    .set(auth)
    .attach("file", file, "x.png")
    .expect(400);
  await api().post(`${base}/cover`).attach("file", file, "x.png").expect(401);
  const definition = app.get(ResourceRegistry).get("articles").attachments![0];
  const original = definition.maxBytes;
  try {
    definition.maxBytes = 1;
    await api()
      .post(`${base}/cover`)
      .set(auth)
      .attach("file", file, "test.png")
      .expect(413);
  } finally {
    definition.maxBytes = original;
  }
  await api()
    .post(`${base}/cover`)
    .set(auth)
    .attach("file", Buffer.alloc(config.ATTACHMENT_MAX_BYTES + 1), "test.png")
    .expect(413);
  const another = await api()
    .post("/api/articles")
    .set(auth)
    .send({ slug: `${prefix}-other`, title: "Other" })
    .expect(201);
  extraIds.push(another.body.id);
  await expect(
    app
      .get(ResourceService)
      .findAttachment("articles", another.body.id, "cover", coverId),
  ).rejects.toMatchObject({ status: 404 });
  await api()
    .get(`/api/articles/${another.body.id}/attachments/cover/${coverId}`)
    .set(auth)
    .expect(404);
  await api()
    .delete(`/api/articles/${another.body.id}/attachments/cover/${coverId}`)
    .set(auth)
    .expect(404);
});
it("keeps old attachments when storage upload fails and retains pending cleanup metadata", async () => {
  const { ServiceUnavailableException } = await import("@nestjs/common");
  const spy = jest
    .spyOn(app.get(S3Service), "upload")
    .mockRejectedValueOnce(new ServiceUnavailableException("unavailable"));
  try {
    await api()
      .post(`/api/articles/${articleId}/attachments/cover`)
      .set(auth)
      .attach("file", file, "test.png")
      .expect(503);
  } finally {
    spy.mockRestore();
  }
  const record = await api()
    .get(`/api/articles/${articleId}`)
    .set(auth)
    .expect(200);
  expect(record.body.cover.id).toBe(coverId);
  expect(
    await db
      .getRepository(AttachmentEntity)
      .countBy({ recordId: articleId, status: "pending" }),
  ).toBe(1);
});
it("serializes single replacements and supports multiple attachments", async () => {
  await Promise.all([upload(), upload()]);
  expect(
    await db.getRepository(AttachmentEntity).countBy({
      resource: "articles",
      recordId: articleId,
      field: "cover",
      status: "ready",
    }),
  ).toBe(1);
  await api()
    .get(`/api/articles/${articleId}/attachments/cover/${coverId}`)
    .set(auth)
    .expect(404);
  const [f1] = await Promise.all([
    upload("files", "a.pdf", "application/pdf"),
    upload("files", "b.pdf", "application/pdf"),
  ]);
  const record = await api()
    .get(`/api/articles/${articleId}`)
    .set(auth)
    .expect(200);
  expect(record.body.files).toHaveLength(2);
  await api()
    .delete(`/api/articles/${articleId}/attachments/files/${f1.id}`)
    .set(auth)
    .expect(200);
  await expect(
    app
      .get(ResourceService)
      .findAttachment("articles", articleId, "files", f1.id),
  ).rejects.toMatchObject({ status: 404 });
  await api()
    .get(`/api/articles/${articleId}/attachments/files/${f1.id}`)
    .set(auth)
    .expect(404);
});
it("deletes records, queues storage cleanup, and removes expired objects", async () => {
  const files = await db
    .getRepository(AttachmentEntity)
    .findBy({ recordId: articleId });
  await api().delete(`/api/articles/${articleId}`).set(auth).expect(200);
  await api().get(`/api/articles/${articleId}`).set(auth).expect(404);
  expect(
    await db
      .getRepository(AttachmentEntity)
      .countBy({ recordId: articleId, status: "ready" }),
  ).toBe(0);
  await db
    .getRepository(AttachmentEntity)
    .update({ recordId: articleId }, { expiresAt: new Date(0) });
  const failedDelete = jest
    .spyOn(app.get(S3Service), "remove")
    .mockRejectedValueOnce(new Error("storage unavailable"));
  const failed = await app.get(AttachmentService).cleanup();
  expect(failed.failures).toHaveLength(1);
  expect(
    await db
      .getRepository(AttachmentEntity)
      .countBy({ id: failed.failures[0] }),
  ).toBe(1);
  failedDelete.mockRestore();
  const result = await app.get(AttachmentService).cleanup();
  expect(result.failures).toEqual([]);
  expect(
    await db.getRepository(AttachmentEntity).countBy({ recordId: articleId }),
  ).toBe(0);
  for (const file of files) {
    await expect(
      s3.send(
        new HeadObjectCommand({ Bucket: config.S3_BUCKET, Key: file.key }),
      ),
    ).rejects.toMatchObject({ $metadata: { httpStatusCode: 404 } });
    if (file.stagingKey)
      await expect(
        s3.send(
          new HeadObjectCommand({
            Bucket: config.S3_BUCKET,
            Key: file.stagingKey,
          }),
        ),
      ).rejects.toMatchObject({ $metadata: { httpStatusCode: 404 } });
  }
});
