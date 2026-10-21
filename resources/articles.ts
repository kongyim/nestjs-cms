import { z } from "zod";
import { BadRequestException } from "@nestjs/common";
import { defineResource, ResourceHook } from "../src/resource/resource.types";
export const schema = z.object({
  title: z.string().trim().min(1).max(200),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  body: z.string().max(10000).default(""),
  status: z.enum(["draft", "published", "archived"]).default("draft"),
  categoryId: z.uuid().nullable().default(null),
});
const validateCategory: ResourceHook = async ({ manager, record }) => {
  if (
    record.categoryId &&
    !(await manager
      .getRepository("categories")
      .existsBy({ id: record.categoryId }))
  ) {
    throw new BadRequestException("categoryId does not exist");
  }
};
export default defineResource({
  name: "articles",
  label: "Articles",
  schema: schema.strict(),
  columns: {
    title: { type: String, length: 200 },
    slug: { type: String, length: 120, unique: true },
    body: { type: "text" },
    status: { type: String, length: 20 },
    categoryId: { type: String, length: 36, nullable: true },
  },
  foreignKeys: [
    {
      target: "categories",
      columnNames: ["categoryId"],
      referencedColumnNames: ["id"],
      onDelete: "RESTRICT",
    },
  ],
  filterable: ["title", "slug", "status", "categoryId"],
  sortable: ["title", "slug", "createdAt", "updatedAt"],
  attachments: [
    { field: "cover", mimeTypes: ["image/jpeg", "image/png", "image/webp"] },
    {
      field: "files",
      multiple: true,
      mimeTypes: ["application/pdf", "image/jpeg", "image/png"],
      maxBytes: 10 * 1024 ** 2,
    },
  ],
  hooks: {
    onBeforeCreate: [validateCategory],
    onBeforeUpdate: [validateCategory],
  },
});
