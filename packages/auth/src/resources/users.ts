import { defineResource, z } from "@nestjs-cms/core";

export default defineResource({
  name: "users",
  schema: z
    .object({
      email: z.string().trim().toLowerCase().email().max(254),
      displayName: z.string().trim().min(1).max(120),
      roleId: z.string().uuid(),
      active: z.boolean().default(true),
    })
    .strict(),
  columns: {
    email: { type: String, length: 254, unique: true },
    displayName: { type: String, length: 120 },
    roleId: { type: String, length: 36 },
    active: { type: Boolean, default: true },
  },
  foreignKeys: [
    {
      target: "roles",
      columnNames: ["roleId"],
      referencedColumnNames: ["id"],
      onDelete: "RESTRICT",
    },
  ],
  filterable: ["email", "roleId", "active"],
  sortable: ["email", "displayName", "createdAt"],
});
