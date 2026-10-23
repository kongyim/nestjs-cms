import { z, ResourceRegistry } from "@nestjs-cms/core";
import type { AuthResourceExtensions } from "../src";
import { createAuthDataSource } from "../src";
import { AuthService } from "../src/auth.service";
import type { DataSource } from "typeorm";

const extra = {
  users: {
    schema: z.object({ phone: z.string().max(30).nullable().default(null) }),
    columns: { phone: { type: String, length: 30, nullable: true } },
    filterable: ["phone"],
  },
  roles: {
    schema: z.object({
      description: z.string().max(500).nullable().default(null),
    }),
    columns: { description: { type: String, length: 500, nullable: true } },
  },
};
const prepare = (resourceExtensions: AuthResourceExtensions = extra) =>
  createAuthDataSource({
    adminOrigin: "http://localhost:3001",
    resourceExtensions,
  });
it("extends strict schemas and entity columns without changing built-in access", () => {
  const result = prepare();
  const user = result.resources.find((r) => r.name === "users")!;
  const input = {
    email: "a@example.com",
    displayName: "A",
    roleId: "123e4567-e89b-42d3-a456-426614174000",
  };
  expect(user.schema.parse(input).phone).toBeNull();
  expect(user.schema.parse({ ...input, phone: "123" }).phone).toBe("123");
  expect(() =>
    user.schema.parse({ ...input, phone: "x".repeat(31) }),
  ).toThrow();
  expect(() => user.schema.parse({ ...input, unexpected: true })).toThrow();
  expect(user.schema.partial().parse({ phone: "456" }).phone).toBe("456");
  expect(user.columns.phone.nullable).toBe(true);
  expect(user.foreignKeys).toHaveLength(1);
  expect(user.filterable).toContain("email");
  expect(user.filterable).toContain("phone");
  expect(result.options.resourcePermissions.users.write).toBe("users:manage");
  expect(
    prepare()
      .resources.find((r) => r.name === "users")!
      .filterable!.filter((f) => f === "phone"),
  ).toHaveLength(1);
});
it("rejects overwrites, missing columns, and fields that would break bootstrap", () => {
  for (const key of ["email", "roleId", "active", "id", "password"]) {
    expect(() =>
      prepare({
        ...extra,
        users: {
          ...extra.users,
          schema: z.object({ [key]: z.string().default("") }),
          columns: { [key]: { type: String } },
        },
      }),
    ).toThrow("Cannot override");
  }
  expect(() =>
    prepare({ ...extra, users: { ...extra.users, columns: {} } }),
  ).toThrow("both a schema and a column");
  expect(() =>
    prepare({
      ...extra,
      users: { ...extra.users, schema: z.object({ phone: z.string() }) },
    }),
  ).toThrow("schema default");
  expect(() =>
    prepare({
      ...extra,
      roles: {
        schema: z.object({ permissions: z.string().default("") }),
        columns: { permissions: { type: String } },
      },
    }),
  ).toThrow("Cannot override");
});
it("bootstrap persists extension defaults for both users and roles", async () => {
  const prepared = prepare();
  const roleRepo = {
    findOneBy: jest.fn().mockResolvedValue(null),
    save: jest.fn(async (row) => row),
  };
  const userRepo = { count: jest.fn().mockResolvedValue(0), insert: jest.fn() };
  const credentials = { insert: jest.fn() };
  const manager = {
    getRepository: (name: unknown) =>
      name === "users" ? userRepo : name === "roles" ? roleRepo : credentials,
  };
  const db = { transaction: jest.fn(async (_isolation, fn) => fn(manager)) };
  const service = new AuthService(
    db as unknown as DataSource,
    new ResourceRegistry(prepared.resources),
    {
      ...prepared.options,
      bootstrapAdmin: {
        email: "admin@example.com",
        password: "a-long-test-password",
      },
    },
  );
  await service.onModuleInit();
  expect(roleRepo.save).toHaveBeenCalledWith(
    expect.objectContaining({
      description: null,
      permissions: ["users:manage"],
    }),
  );
  expect(userRepo.insert).toHaveBeenCalledWith(
    expect.objectContaining({ phone: null, active: true }),
  );
});
