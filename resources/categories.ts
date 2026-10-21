import { z } from "zod";
import { defineResource } from "../src/resource/resource.types";
export const schema = z
  .object({
    slug: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    name: z
      .object({
        en: z.string().max(200),
        tc: z.string().max(200).optional(),
        sc: z.string().max(200).optional(),
      })
      .strict(),
    status: z.enum(["active", "inactive"]).default("active"),
  })
  .strict();
export default defineResource({
  name: "categories",
  label: "Categories",
  schema,
  columns: {
    slug: { type: String, length: 120, unique: true },
    name: { type: "json" },
    status: { type: String, length: 20 },
  },
  filterable: ["slug", "status"],
  sortable: ["slug", "createdAt"],
  attachments: [
    {
      field: "heroImage",
      mimeTypes: ["image/jpeg", "image/png", "image/webp"],
    },
  ],
});
