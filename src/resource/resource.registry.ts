import { Injectable, NotFoundException } from "@nestjs/common";
import { EntitySchema } from "typeorm";
import { z } from "zod";
import { resources } from "./resource.loader";
import { ResourceDefinition } from "./resource.types";
export function createEntity(def: ResourceDefinition) {
  return new EntitySchema({
    name: def.name,
    tableName: def.name,
    foreignKeys: def.foreignKeys,
    columns: {
      id: { type: String, length: 36, primary: true },
      createdAt: { type: Date, createDate: true },
      updatedAt: { type: Date, updateDate: true },
      ...def.columns,
    },
  });
}
@Injectable()
export class ResourceRegistry {
  private readonly definitions = new Map<string, ResourceDefinition>();
  constructor() {
    for (const def of resources) {
      if (!/^[a-z][a-z0-9_]*$/.test(def.name) || this.definitions.has(def.name))
        throw new Error(`Invalid/duplicate resource: ${def.name}`);
      const reserved = ["id", "createdAt", "updatedAt", "attachments"];
      if (
        Object.keys(def.columns).some((k) => reserved.includes(k)) ||
        Object.keys(def.schema.shape).some((k) => reserved.includes(k))
      )
        throw new Error(`Reserved field in ${def.name}`);
      for (const key of [...(def.filterable ?? []), ...(def.sortable ?? [])]) {
        if (
          !Object.hasOwn(def.columns, key) &&
          !["id", "createdAt", "updatedAt"].includes(key)
        )
          throw new Error(`Unknown query field ${key}`);
      }
      const fields = def.attachments ?? [];
      if (
        new Set(fields.map((f) => f.field)).size !== fields.length ||
        fields.some(
          (f) =>
            !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(f.field) || !f.mimeTypes.length,
        )
      )
        throw new Error("Invalid attachment definition");
      this.definitions.set(def.name, def);
    }
  }
  get(name: string) {
    const def = this.definitions.get(name);
    if (!def) throw new NotFoundException("Resource not found");
    return def;
  }
  describe() {
    return [...this.definitions.values()].map((d) => ({
      name: d.name,
      label: d.label ?? d.name,
      schema: z.toJSONSchema(d.schema, { io: "input" }),
      filterable: d.filterable ?? [],
      sortable: d.sortable ?? [],
      attachments: d.attachments ?? [],
    }));
  }
}
