import "reflect-metadata";
import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import { DataSource } from "typeorm";
import request from "supertest";
import { randomUUID } from "node:crypto";
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { AppModule } from "../src/app.module";
import { dataSource } from "../src/database/data-source";
import { config } from "../src/config";
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
    .post(`/api/articles/${articleId}/attachments/${field}/uploads`)
    .set(auth)
    .send({ name, mimeType: type, size: file.length })
    .expect(201);
  const put = await fetch(response.body.url, {
    method: "PUT",
    headers: response.body.headers,
    body: file,
  });
  expect(put.status).toBe(200);
  return response.body;
};
const complete = (field: string, id: string) =>
  api()
    .post(`/api/articles/${articleId}/attachments/${field}/${id}/complete`)
    .set(auth)
    .send();

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
  expect(created.body.attachments.cover).toBeNull();
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
      query: JSON.stringify({ slug: prefix, title: { contains: "100%_" } }),
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
it("uploads directly to MinIO, completes idempotently and downloads privately", async () => {
  const pending = await upload();
  coverId = pending.id;
  await complete("cover", coverId).expect(201);
  await complete("cover", coverId).expect(201);
  const record = await api()
    .get(`/api/articles/${articleId}`)
    .set(auth)
    .expect(200);
  expect(record.body.attachments.cover.id).toBe(coverId);
  const link = await api()
    .get(`/api/articles/${articleId}/attachments/cover/${coverId}`)
    .set(auth)
    .expect(200);
  const downloaded = await fetch(link.body.url);
  expect(downloaded.status).toBe(200);
  expect(Buffer.from(await downloaded.arrayBuffer())).toEqual(file);
  expect(link.body.key).toBeUndefined();
  // Replaying the staging PUT never changes the finalized object.
  const replay = Buffer.alloc(file.length, 65);
  expect(
    (
      await fetch(pending.url, {
        method: "PUT",
        headers: pending.headers,
        body: replay,
      })
    ).status,
  ).toBe(200);
  expect(Buffer.from(await (await fetch(link.body.url)).arrayBuffer())).toEqual(
    file,
  );
});
it("rejects forged fields, types, sizes, cross-record binding and metadata mismatch", async () => {
  const base = `/api/articles/${articleId}/attachments`;
  for (const body of [
    { name: "x", mimeType: "text/html", size: 10 },
    { name: "../x", mimeType: "image/png", size: 10 },
    { name: "x", mimeType: "image/png", size: 999999999 },
  ]) {
    await api().post(`${base}/cover/uploads`).set(auth).send(body).expect(400);
  }
  await api().post(`${base}/invalid/uploads`).set(auth).send({}).expect(400);
  const another = await api()
    .post("/api/articles")
    .set(auth)
    .send({ slug: `${prefix}-other`, title: "Other" })
    .expect(201);
  extraIds.push(another.body.id);
  await api()
    .post(
      `/api/articles/${another.body.id}/attachments/cover/${coverId}/complete`,
    )
    .set(auth)
    .expect(404);
  const pending = await upload();
  await s3.send(
    new PutObjectCommand({
      Bucket: config.S3_BUCKET,
      Key: `staging/${pending.id}`,
      Body: "bad",
      ContentType: "image/png",
    }),
  );
  await complete("cover", pending.id).expect(400);
  await db
    .getRepository(AttachmentEntity)
    .update(pending.id, { expiresAt: new Date(0) });
  await complete("cover", pending.id).expect(400);
});
it("serializes single replacements and supports multiple attachments", async () => {
  const [a, b] = await Promise.all([upload(), upload()]);
  await Promise.all([
    complete("cover", a.id).expect(201),
    complete("cover", b.id).expect(201),
  ]);
  expect(
    await db.getRepository(AttachmentEntity).countBy({
      resource: "articles",
      recordId: articleId,
      field: "cover",
      status: "ready",
    }),
  ).toBe(1);
  const [f1, f2] = await Promise.all([
    upload("files", "a.pdf", "application/pdf"),
    upload("files", "b.pdf", "application/pdf"),
  ]);
  await Promise.all([
    complete("files", f1.id).expect(201),
    complete("files", f2.id).expect(201),
  ]);
  const record = await api()
    .get(`/api/articles/${articleId}`)
    .set(auth)
    .expect(200);
  expect(record.body.attachments.files).toHaveLength(2);
  await api()
    .delete(`/api/articles/${articleId}/attachments/files/${f1.id}`)
    .set(auth)
    .expect(200);
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
