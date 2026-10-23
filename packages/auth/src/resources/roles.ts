import { defineResource, z } from "@nestjs-cms/core";

export function createRolesResource(permissions: string[]) {
  return defineResource({
    name: "roles",
    schema: z
      .object({
        name: z.string().trim().min(1).max(80),
        permissions: z
          .array(z.enum(permissions as [string, ...string[]]))
          .max(permissions.length)
          .default([]),
      })
      .strict(),
    columns: {
      name: { type: String, length: 80, unique: true },
      permissions: { type: "json" },
    },
    filterable: ["name"],
    sortable: ["name", "createdAt"],
  });
}
