import { DataSource } from "typeorm";
import { z } from "zod";
import { ResourceService } from "../src/resource/resource.service";
import { ResourceRegistry } from "../src/resource/resource.registry";
import { ResourceRecordStore } from "../src/resource/resource-record.store";
import { AttachmentService } from "../src/storage/attachment.service";
import { AttachmentEntity, attachmentMetadata } from "../src/storage/attachment.entity";

const definition = {
  name: "pages",
  schema: z.object({ title: z.string() }),
  columns: { title: { type: String } },
  attachments: [
    { field: "cover", mimeTypes: ["image/jpeg"] },
    { field: "documents", multiple: true, mimeTypes: ["application/pdf"] },
  ],
};

it.each(["id", "createdAt", "updatedAt", "attachments", "title", "schemaOnly", "columnOnly"])("rejects attachment name collision: %s", (field) => {
  expect(() => new ResourceRegistry([{
    ...definition,
    schema: definition.schema.extend({ schemaOnly: z.string() }),
    columns: { ...definition.columns, columnOnly: { type: String } },
    attachments: [{ field, mimeTypes: ["image/jpeg"] }],
  }])).toThrow("Invalid attachment definition");
});

it("presents top-level attachments consistently on list, get, create and update", async () => {
  let row = { id: "record", title: "Example" };
  const file = { id: "cover-id", recordId: row.id, field: "cover", name: "cover.jpg", mimeType: "image/jpeg", size: 12, createdAt: new Date(), key: "private-key" };
  let files: any[] = [file, { ...file, id: "doc-id", field: "documents" }];
  const fileRepo = { findBy: jest.fn(async () => files) };
  const qb: any = { getManyAndCount: async () => [[row], 1] };
  for (const method of ["orderBy", "addOrderBy", "skip", "take"]) qb[method] = () => qb;
  const repo = {
    createQueryBuilder: () => qb,
    save: async (data: typeof row) => (row = data),
    update: async (_: unknown, data: Partial<typeof row>) => { row = { ...row, ...data }; },
  };
  const manager = { getRepository: (entity: unknown) => entity === AttachmentEntity ? fileRepo : repo };
  const db = { manager, getRepository: () => repo, transaction: async (fn: Function) => fn(manager) };
  const service = new ResourceService(db as unknown as DataSource, new ResourceRegistry([definition]), { find: async () => row } as unknown as ResourceRecordStore, {} as AttachmentService);
  const detail = await service.get("pages", row.id);
  expect(detail).toEqual({ ...row, cover: attachmentMetadata(file as any), documents: [attachmentMetadata(files[1])] });
  expect(detail).not.toHaveProperty("attachments");
  expect(detail.cover).not.toHaveProperty("key");
  expect((await service.list("pages", {})).data).toEqual([detail]);
  files = [];
  expect(await service.create("pages", { title: "New" })).toEqual({ id: expect.any(String), title: "New", cover: null, documents: [] });
  expect(await service.update("pages", row.id, { title: "Updated" })).toEqual({ id: row.id, title: "Updated", cover: null, documents: [] });
  expect(fileRepo.findBy).toHaveBeenCalledWith(expect.objectContaining({ resource: "pages", status: "ready" }));
});
