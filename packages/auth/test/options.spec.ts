import { defineResource, z } from "@nestjs-cms/core";
import { resolveOptions } from "../src/options";
import { createAuthDataSource } from "../src";
const page = defineResource({
  name: "pages",
  schema: z.object({ title: z.string() }),
  columns: { title: { type: String } },
});
const base = { adminOrigin: "http://localhost:3001" };
it("derives permissions, locks built-in access, and normalizes the cookie prefix", () => {
  const options = resolveOptions({ ...base, adminBasePath: "/tools/cms/" }, [
    page,
  ]);
  expect(options.cookiePath).toBe("/tools/cms/api");
  expect(options.permissions).toEqual([
    "users:manage",
    "pages:read",
    "pages:write",
  ]);
  expect(options.resourcePermissions.users.write).toBe("users:manage");
});
it("rejects reserved resources, duplicates, unknown mappings and invalid origins", () => {
  for (const name of [
    "users",
    "roles",
    "auth",
    "admin_credentials",
    "admin_sessions",
  ]) {
    expect(() => resolveOptions(base, [{ ...page, name }])).toThrow("Reserved");
  }
  expect(() => resolveOptions(base, [page, page])).toThrow("Duplicate");
  expect(() =>
    resolveOptions(
      {
        ...base,
        resourcePermissions: {
          users: { read: "public:read", write: "public:write" },
        },
      },
      [],
    ),
  ).toThrow("unknown");
  expect(() =>
    resolveOptions({ ...base, adminOrigin: "http://localhost:3001/admin" }, []),
  ).toThrow("origin");
  expect(() => resolveOptions({ ...base, adminBasePath: "/a;b" }, [])).toThrow(
    "adminBasePath",
  );
  expect(() => resolveOptions({ ...base, sessionLifetimeMs: 0 }, [])).toThrow(
    "sessionLifetimeMs",
  );
  expect(() =>
    resolveOptions(
      {
        ...base,
        bootstrapAdmin: { email: "admin@example.com", password: "short" },
      },
      [],
    ),
  ).toThrow("bootstrap");
});
it("assembles auth tables for migration generation without opening a connection", () => {
  const prepared = createAuthDataSource({ ...base, resources: [page] });
  expect(prepared.dataSource.isInitialized).toBe(false);
  expect(prepared.resources.map((resource) => resource.name)).toEqual([
    "pages",
    "roles",
    "users",
  ]);
  const names = (
    prepared.dataSource.options.entities as { options: { name: string } }[]
  ).map((entity) => entity.options.name);
  expect(names).toEqual(
    expect.arrayContaining([
      "admin_credentials",
      "admin_sessions",
      "roles",
      "users",
      "pages",
    ]),
  );
});

it("requires an HTTPS browser origin in production", () => {
  const original = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    expect(() => resolveOptions(base, [])).toThrow("HTTPS");
    expect(
      resolveOptions({ adminOrigin: "https://cms.example.com" }, []).cookiePath,
    ).toBe("/admin/api");
  } finally {
    if (original === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = original;
  }
});
