import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { App } from "supertest/types";
import { DataSource } from "typeorm";
import { CmsAuthModule } from "../src";
import { Controller, Get, Module } from "@nestjs/common";
import { defineResource, z } from "@nestjs-cms/core";

@Controller("health")
class HealthController {
  @Get() health() {
    return { ok: true };
  }
}
const categories = defineResource({
  name: "categories",
  schema: z.object({ name: z.string() }).strict(),
  columns: { name: { type: String } },
});
const pages = defineResource({
  name: "pages",
  schema: z
    .object({
      title: z.string(),
      categoryId: z.string().uuid().nullable().default(null),
    })
    .strict(),
  columns: {
    title: { type: String },
    categoryId: { type: String, length: 36, nullable: true },
  },
  attachments: [{ field: "cover", mimeTypes: ["image/png"] }],
  foreignKeys: [
    {
      target: "categories",
      columnNames: ["categoryId"],
      referencedColumnNames: ["id"],
      onDelete: "RESTRICT",
    },
  ],
});
import { Credential, Session } from "../src/auth.entities";

// Run only against an explicitly configured, disposable database.
describe("Admin authentication and resource permissions (e2e)", () => {
  let app: INestApplication<App>;
  let db: DataSource;
  let adminCookie: string;
  let readerCookie: string;
  let readerId: string;
  let readerRoleId: string;
  const password = "test-admin-password-123";
  const headers = { "X-CMS-Request": "1", Origin: "http://localhost:3001" };

  beforeAll(async () => {
    if (
      process.env.AUTH_TEST_DATABASE !== "1" ||
      !process.env.DB_DATABASE?.endsWith("_test")
    ) {
      throw new Error(
        "Use AUTH_TEST_DATABASE=1 and a disposable DB_DATABASE ending in _test.",
      );
    }
    process.env.ADMIN_BOOTSTRAP_EMAIL = "admin@example.test";
    process.env.ADMIN_BOOTSTRAP_PASSWORD = password;
    await start();
  });

  async function start(bootstrapPassword = password) {
    const module = await Test.createTestingModule({
      controllers: [HealthController],
      imports: [
        CmsAuthModule.forRoot({
          resources: [pages, categories],
          adminOrigin: "http://localhost:3001",
          bootstrapAdmin: {
            email: "admin@example.test",
            password: bootstrapPassword,
          },
          resourcePermissions: {
            categories: { read: "pages:read", write: "pages:write" },
          },
        }),
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
    db = app.get(DataSource);
  }
  afterAll(async () => {
    if (app) await app.close();
  });

  it("rejects anonymous access even with the shared API key", async () => {
    await request(app.getHttpServer()).get("/health").expect(200);
    for (const path of [
      "/api/pages",
      "/api/categories",
      "/api/users",
      "/api/roles",
      "/api/_resources",
      "/api/auth/me",
    ]) {
      await request(app.getHttpServer())
        .get(path)
        .set("X-API-Key", process.env.ADMIN_API_KEY ?? "")
        .expect(401);
    }
  });

  it("rejects CSRF and wrong passwords, then issues a protected cookie", async () => {
    await request(app.getHttpServer())
      .post("/api/auth/login")
      .send({})
      .expect(403);
    await request(app.getHttpServer())
      .post("/api/auth/login")
      .set(headers)
      .set("Origin", "https://evil.example")
      .send({})
      .expect(403);
    await request(app.getHttpServer())
      .post("/api/auth/login")
      .set(headers)
      .send({ email: "admin@example.test", password: "incorrect" })
      .expect(401);
    const response = await request(app.getHttpServer())
      .post("/api/auth/login")
      .set(headers)
      .send({ email: "ADMIN@example.test", password })
      .expect(200);
    const cookies = response.headers["set-cookie"] as unknown as string[];
    expect(cookies[0]).toContain("HttpOnly");
    expect(cookies[0]).toContain("SameSite=Strict");
    expect(cookies[0]).toContain(
      `Path=${(process.env.ADMIN_BASE_PATH ?? "/admin").trim().replace(/\/+$/, "")}/api`,
    );
    adminCookie = cookies[0].split(";")[0];
    expect(JSON.stringify(response.body)).not.toContain("password");
    const sessions = await db.getRepository(Session).find();
    expect(sessions[0].tokenHash).not.toBe(adminCookie.split("=")[1]);
    await request(app.getHttpServer())
      .get("/api/pages")
      .set("Cookie", adminCookie)
      .expect(200);
  });

  it("creates roles and users without exposing credentials", async () => {
    const role = await request(app.getHttpServer())
      .post("/api/roles")
      .set(headers)
      .set("Cookie", adminCookie)
      .send({ name: "Reader", permissions: ["pages:read"] })
      .expect(201);
    readerRoleId = (role.body as { id: string }).id;
    const user = await request(app.getHttpServer())
      .post("/api/users")
      .set(headers)
      .set("Cookie", adminCookie)
      .send({
        email: "Reader@example.test",
        displayName: "Reader",
        roleId: readerRoleId,
      })
      .expect(201);
    readerId = (user.body as { id: string }).id;
    expect((user.body as { email: string }).email).toBe("reader@example.test");
    await request(app.getHttpServer())
      .put(`/api/auth/users/${readerId}/password`)
      .set(headers)
      .set("Cookie", adminCookie)
      .send({ password: "short" })
      .expect(400);
    await request(app.getHttpServer())
      .put(`/api/auth/users/${readerId}/password`)
      .set(headers)
      .set("Cookie", adminCookie)
      .send({ password })
      .expect(200);
    const credential = await db
      .getRepository(Credential)
      .findOneByOrFail({ userId: readerId });
    expect(credential.passwordHash).toMatch(/^scrypt\$/);
    const users = await request(app.getHttpServer())
      .get("/api/users")
      .set("Cookie", adminCookie)
      .expect(200);
    expect(JSON.stringify(users.body)).not.toContain("password");
    const login = await request(app.getHttpServer())
      .post("/api/auth/login")
      .set(headers)
      .send({ email: "reader@example.test", password })
      .expect(200);
    readerCookie = (
      login.headers["set-cookie"] as unknown as string[]
    )[0].split(";")[0];
  });

  it("links pages to categories, preserves uncategorized pages, and enforces references", async () => {
    const category = await request(app.getHttpServer())
      .post("/api/categories")
      .set(headers)
      .set("Cookie", adminCookie)
      .send({ name: "News" })
      .expect(201);
    const categoryId = (category.body as { id: string }).id;
    const page = await request(app.getHttpServer())
      .post("/api/pages")
      .set(headers)
      .set("Cookie", adminCookie)
      .send({ title: "Announcement", categoryId })
      .expect(201);
    const pageId = (page.body as { id: string }).id;
    expect((page.body as { categoryId: string }).categoryId).toBe(categoryId);
    await request(app.getHttpServer())
      .get("/api/categories")
      .set("Cookie", readerCookie)
      .expect(200);
    await request(app.getHttpServer())
      .post("/api/categories")
      .set(headers)
      .set("Cookie", readerCookie)
      .send({ name: "Forbidden" })
      .expect(403);
    await request(app.getHttpServer())
      .delete(`/api/categories/${categoryId}`)
      .set(headers)
      .set("Cookie", adminCookie)
      .expect(409);
    await request(app.getHttpServer())
      .post("/api/pages")
      .set(headers)
      .set("Cookie", adminCookie)
      .send({
        title: "Invalid category",
        categoryId: "a630cd25-982c-4e0a-b751-abfd8a371b8a",
      })
      .expect(409);
    const uncategorized = await request(app.getHttpServer())
      .post("/api/pages")
      .set(headers)
      .set("Cookie", adminCookie)
      .send({ title: "Legacy-style page" })
      .expect(201);
    expect(
      (uncategorized.body as { categoryId: string | null }).categoryId,
    ).toBeNull();
    await request(app.getHttpServer())
      .patch(`/api/pages/${pageId}`)
      .set(headers)
      .set("Cookie", adminCookie)
      .send({ title: "Updated announcement" })
      .expect(200);
    const retained = await request(app.getHttpServer())
      .get(`/api/pages/${pageId}`)
      .set("Cookie", adminCookie)
      .expect(200);
    expect((retained.body as { categoryId: string }).categoryId).toBe(
      categoryId,
    );
    await request(app.getHttpServer())
      .patch(`/api/pages/${pageId}`)
      .set(headers)
      .set("Cookie", adminCookie)
      .send({ categoryId: null })
      .expect(200);
    await request(app.getHttpServer())
      .delete(`/api/categories/${categoryId}`)
      .set(headers)
      .set("Cookie", adminCookie)
      .expect(200);
  });

  it("enforces role permissions and applies role updates immediately", async () => {
    await request(app.getHttpServer())
      .post("/api/pages/missing/attachments/cover")
      .set(headers)
      .set("Cookie", readerCookie)
      .expect(403);
    await request(app.getHttpServer())
      .get("/api/admin_credentials")
      .set("Cookie", adminCookie)
      .expect(403);
    await request(app.getHttpServer())
      .get("/api/_resources")
      .set("Cookie", readerCookie)
      .expect(403);

    await request(app.getHttpServer())
      .get("/api/pages")
      .set("Cookie", readerCookie)
      .expect(200);
    await request(app.getHttpServer())
      .post("/api/pages")
      .set(headers)
      .set("Cookie", readerCookie)
      .send({ title: "Forbidden" })
      .expect(403);
    await request(app.getHttpServer())
      .get("/api/users")
      .set("Cookie", readerCookie)
      .expect(403);
    await request(app.getHttpServer())
      .patch(`/api/users/${readerId}`)
      .set(headers)
      .set("Cookie", readerCookie)
      .send({ active: true })
      .expect(403);
    await request(app.getHttpServer())
      .put(`/api/auth/users/${readerId}/password`)
      .set(headers)
      .set("Cookie", readerCookie)
      .send({ password })
      .expect(403);
    await request(app.getHttpServer())
      .patch(`/api/roles/${readerRoleId}`)
      .set(headers)
      .set("Cookie", adminCookie)
      .send({ permissions: [] })
      .expect(200);
    await request(app.getHttpServer())
      .get("/api/pages")
      .set("Cookie", readerCookie)
      .expect(403);
  });

  it("blocks disabled users and revokes sessions on password reset", async () => {
    await request(app.getHttpServer())
      .patch(`/api/users/${readerId}`)
      .set(headers)
      .set("Cookie", adminCookie)
      .send({ active: false })
      .expect(200);
    await request(app.getHttpServer())
      .get("/api/auth/me")
      .set("Cookie", readerCookie)
      .expect(401);
    await request(app.getHttpServer())
      .post("/api/auth/login")
      .set(headers)
      .send({ email: "reader@example.test", password })
      .expect(401);
    await request(app.getHttpServer())
      .patch(`/api/users/${readerId}`)
      .set(headers)
      .set("Cookie", adminCookie)
      .send({ active: true })
      .expect(200);
    await request(app.getHttpServer())
      .put(`/api/auth/users/${readerId}/password`)
      .set(headers)
      .set("Cookie", adminCookie)
      .send({ password: "replacement-password-123" })
      .expect(200);
    await request(app.getHttpServer())
      .get("/api/auth/me")
      .set("Cookie", readerCookie)
      .expect(401);
    await request(app.getHttpServer())
      .post("/api/auth/login")
      .set(headers)
      .send({ email: "reader@example.test", password })
      .expect(401);
  });

  it("revokes logout sessions and rejects expired sessions", async () => {
    await request(app.getHttpServer())
      .post("/api/auth/logout")
      .set(headers)
      .set("Cookie", adminCookie)
      .expect(200);
    await request(app.getHttpServer())
      .get("/api/auth/me")
      .set("Cookie", adminCookie)
      .expect(401);
    const login = await request(app.getHttpServer())
      .post("/api/auth/login")
      .set(headers)
      .send({ email: "admin@example.test", password })
      .expect(200);
    const cookie = (
      login.headers["set-cookie"] as unknown as string[]
    )[0].split(";")[0];
    await db
      .getRepository(Session)
      .createQueryBuilder()
      .update()
      .set({ expiresAt: new Date(0) })
      .execute();
    await request(app.getHttpServer())
      .get("/api/auth/me")
      .set("Cookie", cookie)
      .expect(401);
  });

  it("persists sessions across restarts and never resets existing bootstrap accounts", async () => {
    // Previous tests expired sessions; log in with the original password again.
    const login = await request(app.getHttpServer())
      .post("/api/auth/login")
      .set(headers)
      .send({ email: "admin@example.test", password })
      .expect(200);
    const cookie = (
      login.headers["set-cookie"] as unknown as string[]
    )[0].split(";")[0];
    await app.close();
    await start("different-bootstrap-password-123");
    await request(app.getHttpServer())
      .get("/api/auth/me")
      .set("Cookie", cookie)
      .expect(200);
    await request(app.getHttpServer())
      .post("/api/auth/login")
      .set(headers)
      .send({
        email: "admin@example.test",
        password: "different-bootstrap-password-123",
      })
      .expect(401);
    await request(app.getHttpServer())
      .post("/api/auth/login")
      .set(headers)
      .send({ email: "admin@example.test", password })
      .expect(200);
    expect(await db.getRepository("users").count()).toBe(2);
  });

  it("limits repeated login attempts", async () => {
    let status = 0;
    for (let i = 0; i < 11; i++) {
      status = (
        await request(app.getHttpServer())
          .post("/api/auth/login")
          .set(headers)
          .send({})
      ).status;
    }
    expect(status).toBe(429);
  });
});
