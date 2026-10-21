import { Injectable, NotFoundException } from "@nestjs/common";
import { EntityManager } from "typeorm";
import { ResourceRegistry } from "./resource.registry";
import { recordId } from "./validation";

// Shared record lookup and locking, without a dependency on the resource facade.
@Injectable()
export class ResourceRecordStore {
  constructor(private readonly registry: ResourceRegistry) {}

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
}
