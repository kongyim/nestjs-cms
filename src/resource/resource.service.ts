import { Injectable, NotFoundException } from "@nestjs/common";
import { DataSource, EntityManager, In } from "typeorm";
import { randomUUID } from "node:crypto";
import { ResourceRegistry } from "./resource.registry";
import { HookAction, RecordData, ResourceDefinition } from "./resource.types";
import { parse, recordId } from "./validation";
import { applyQuery } from "./query";
import {
  AttachmentEntity,
  attachmentMetadata,
} from "../storage/attachment.entity";
@Injectable()
export class ResourceService {
  constructor(
    private readonly db: DataSource,
    private readonly registry: ResourceRegistry,
  ) {}
  async find(manager: EntityManager, name: string, id: string, lock = false) {
    this.registry.get(name);
    recordId(id);
    const record = await manager.getRepository(name).findOne({
      where: { id },
      ...(lock ? { lock: { mode: "pessimistic_write" as const } } : {}),
    });
    if (!record) throw new NotFoundException("Record not found");
    return record;
  }
  private async present(
    manager: EntityManager,
    name: string,
    rows: RecordData[],
  ): Promise<RecordData[]> {
    if (!rows.length) return [];
    const files = await manager.getRepository(AttachmentEntity).findBy({
      resource: name,
      recordId: In(rows.map((r) => String(r.id))),
      status: "ready",
    });
    const def = this.registry.get(name);
    return rows.map((row) => ({
      ...row,
      attachments: Object.fromEntries(
        (def.attachments ?? []).map((f) => {
          const matches = files
            .filter((a) => a.recordId === row.id && a.field === f.field)
            .sort(
              (a, b) =>
                a.createdAt.getTime() - b.createdAt.getTime() ||
                a.id.localeCompare(b.id),
            )
            .map(attachmentMetadata);
          return [f.field, f.multiple ? matches : (matches[0] ?? null)];
        }),
      ),
    }));
  }
  async list(name: string, raw: unknown) {
    const def = this.registry.get(name);
    const qb = this.db.getRepository(name).createQueryBuilder("r");
    const { page, limit } = applyQuery(qb, def, raw);
    const [rows, total] = await qb.getManyAndCount();
    return {
      data: await this.present(this.db.manager, name, rows),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }
  async get(name: string, id: string) {
    return (
      await this.present(this.db.manager, name, [
        await this.find(this.db.manager, name, id),
      ])
    )[0];
  }
  private async hooks(
    def: ResourceDefinition,
    action: HookAction,
    manager: EntityManager,
    id: string,
    record: RecordData,
    previous?: RecordData,
  ) {
    let current = structuredClone(record);
    for (const hook of def.hooks?.[action] ?? []) {
      const result = await hook({
        manager,
        resource: def.name,
        action,
        id,
        record: current,
        previous: previous && structuredClone(previous),
      });
      if (action.startsWith("onBefore") && result) current = result;
    }
    return current;
  }
  async create(name: string, body: unknown) {
    const def = this.registry.get(name);
    const input = parse(def.schema.strict(), body);
    const id = randomUUID();
    await this.db.transaction(async (manager) => {
      const modified = await this.hooks(
        def,
        "onBeforeCreate",
        manager,
        id,
        input,
      );
      const data = parse(def.schema.strict(), modified);
      const saved = await manager.getRepository(name).save({ ...data, id });
      await this.hooks(def, "onAfterCreate", manager, id, saved);
    });
    return this.get(name, id);
  }
  async update(name: string, id: string, body: unknown) {
    const def = this.registry.get(name);
    // Discard defaults produced by partial() for keys the client did not send.
    const parsedPatch = parse(
      def.updateSchema ?? def.schema.partial().strict(),
      body,
    ) as RecordData;
    const patch = Object.fromEntries(
      Object.entries(parsedPatch).filter(([key]) =>
        Object.hasOwn(body as object, key),
      ),
    );
    await this.db.transaction(async (manager) => {
      const previous = await this.find(manager, name, id, true);
      const {
        id: _id,
        createdAt: _created,
        updatedAt: _updated,
        ...existing
      } = previous;
      const merged = parse(def.schema.strict(), { ...existing, ...patch });
      const modified = await this.hooks(
        def,
        "onBeforeUpdate",
        manager,
        id,
        merged,
        previous,
      );
      const data = parse(def.schema.strict(), modified);
      await manager.getRepository(name).update({ id }, data);
      await this.hooks(
        def,
        "onAfterUpdate",
        manager,
        id,
        await this.find(manager, name, id),
        previous,
      );
    });
    return this.get(name, id);
  }
  async delete(name: string, id: string) {
    const def = this.registry.get(name);
    await this.db.transaction(async (manager) => {
      const previous = await this.find(manager, name, id, true);
      await this.hooks(def, "onBeforeDelete", manager, id, previous, previous);
      await manager.getRepository(name).delete({ id });
      await manager
        .getRepository(AttachmentEntity)
        .update({ resource: name, recordId: id }, { status: "deleted" });
      await this.hooks(def, "onAfterDelete", manager, id, previous, previous);
    });
    return { id, deleted: true };
  }
}
