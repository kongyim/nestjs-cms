import { EntitySchema } from "typeorm";
export interface Attachment {
  id: string;
  resource: string;
  recordId: string;
  field: string;
  name: string;
  mimeType: string;
  size: number;
  stagingKey: string;
  key: string;
  status: "pending" | "ready" | "deleted";
  expiresAt: Date;
  createdAt: Date;
}
export const AttachmentEntity = new EntitySchema<Attachment>({
  name: "Attachment",
  tableName: "cms_attachments",
  columns: {
    id: { type: String, length: 36, primary: true },
    resource: { type: String, length: 100 },
    recordId: { type: String, length: 36 },
    field: { type: String, length: 100 },
    name: { type: String, length: 255 },
    mimeType: { type: String, length: 120 },
    size: { type: Number },
    stagingKey: { type: String, length: 512 },
    key: { type: String, length: 512 },
    status: { type: String, length: 10 },
    expiresAt: { type: Date },
    createdAt: { type: Date, createDate: true },
  },
  indices: [
    { columns: ["resource", "recordId", "status"] },
    { columns: ["status", "expiresAt"] },
  ],
});
export function attachmentMetadata(a: Attachment) {
  return {
    id: a.id,
    name: a.name,
    mimeType: a.mimeType,
    size: a.size,
    createdAt: a.createdAt,
  };
}
