import { AttachmentService } from "../src/storage/attachment.service";
import { ResourceRegistry } from "../src/resource/resource.registry";
import { z } from "zod";

function setup() {
  const rows = new Map<string, any>();
  const matches = (row: any, where: any) =>
    Object.entries(where).every(([key, value]) => row[key] === value);
  const repo = {
    save: async (row: any) => {
      const saved = { createdAt: new Date(), ...row };
      rows.set(row.id, saved);
      return saved;
    },
    findOneBy: async (where: any) =>
      [...rows.values()].find((row) => matches(row, where)),
    findOneByOrFail: async (where: any) => {
      const row = await repo.findOneBy(where);
      if (!row) throw Error("missing");
      return row;
    },
    existsBy: async (where: any) => !!(await repo.findOneBy(where)),
    update: async (where: any, patch: any) => {
      for (const row of rows.values())
        if (matches(row, where)) Object.assign(row, patch);
    },
    delete: async ({ id }: any) => {
      rows.delete(id);
    },
  };
  const manager = { getRepository: () => repo };
  const registry = new ResourceRegistry([
    {
      name: "pages",
      schema: z.object({ title: z.string() }),
      columns: { title: { type: String } },
      attachments: [{ field: "cover", mimeTypes: ["image/png"], maxBytes: 10 }],
    },
  ]);
  const storage = { upload: jest.fn(async () => {}) };
  const service = new AttachmentService(
    manager as any,
    registry,
    {} as any,
    storage as any,
  );
  const file = {
    originalname: "a.png",
    mimetype: "image/png",
    buffer: Buffer.from("image"),
  };
  return { rows, repo, manager, storage, service, file };
}

it("retains pending metadata when object storage fails and rejects invalid files before staging", async () => {
  const { rows, storage, service, file } = setup();
  await expect(
    service.stageImport("pages", "page", "cover", {
      ...file,
      mimetype: "text/html",
    }),
  ).rejects.toThrow();
  await expect(
    service.stageImport("pages", "page", "cover", {
      ...file,
      buffer: Buffer.alloc(11),
    }),
  ).rejects.toThrow();
  expect(rows.size).toBe(0);
  storage.upload.mockRejectedValueOnce(new Error("storage down"));
  await expect(
    service.stageImport("pages", "page", "cover", file),
  ).rejects.toThrow("storage down");
  expect([...rows.values()]).toEqual([
    expect.objectContaining({ status: "pending" }),
  ]);
});

it("publishes staged files, replaces a single field and deduplicates stable identities", async () => {
  const { rows, repo, manager, service, file } = setup();
  await repo.save({
    id: "old",
    resource: "pages",
    recordId: "page",
    field: "cover",
    status: "ready",
    key: "old-key",
  });
  const pending = await service.stageImport("pages", "page", "cover", file);
  expect(rows.get("old").status).toBe("ready");
  await service.commitImport(manager as any, pending, "stable");
  expect(rows.get("old").status).toBe("deleted");
  expect(rows.get("stable").status).toBe("ready");
  expect(rows.has(pending)).toBe(false);
  expect(await service.hasImported("stable", "pages", "page", "cover")).toBe(
    true,
  );
  const duplicate = await service.stageImport("pages", "page", "cover", file);
  await service.commitImport(manager as any, duplicate, "stable");
  expect(rows.get(duplicate).status).toBe("deleted");
  expect(
    [...rows.values()].filter((row) => row.status === "ready"),
  ).toHaveLength(1);
});

it("keeps replaced storage keys discoverable when restoring a deleted import identity", async () => {
  const { rows, repo, manager, service, file } = setup();
  await repo.save({
    id: "stable",
    resource: "pages",
    recordId: "page",
    field: "cover",
    status: "deleted",
    key: "old-key",
  });
  const pending = await service.stageImport("pages", "page", "cover", file);
  await service.commitImport(manager as any, pending, "stable");
  expect(rows.get("stable").status).toBe("ready");
  expect([...rows.values()]).toContainEqual(
    expect.objectContaining({ key: "old-key", status: "deleted" }),
  );
});
