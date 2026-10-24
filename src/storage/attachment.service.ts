import {
  BadRequestException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { config } from "../config";
import { ResourceRegistry } from "../resource/resource.registry";
import { ResourceRecordStore } from "../resource/resource-record.store";
import type { UploadedAttachment } from "./attachment.types";
import { parse, recordId } from "../resource/validation";
import { AttachmentEntity, attachmentMetadata } from "./attachment.entity";
import { S3Service } from "./s3.service";
@Injectable()
export class AttachmentService {
  constructor(
    private readonly db: DataSource,
    private readonly registry: ResourceRegistry,
    private readonly records: ResourceRecordStore,
    private readonly s3: S3Service,
  ) {}
  private field(resource: string, field: string) {
    const definition = this.registry
      .get(resource)
      .attachments?.find((f) => f.field === field);
    if (!definition) throw new BadRequestException("Unknown attachment field");
    return definition;
  }
  async upload(
    resource: string,
    id: string,
    field: string,
    file?: UploadedAttachment,
  ) {
    const input = this.validateFile(resource, field, file);
    const definition = this.field(resource, field);
    const attachmentId = randomUUID();
    const key = `attachments/${resource}/${id}/${field}/${attachmentId}`;
    // Retain the existing storage schema so previously stored attachments remain readable.
    // New uploads never use a staging object or issue browser-accessible storage URLs.
    await this.db.transaction(async (manager) => {
      await this.records.find(manager, resource, id, true);
      return manager.getRepository(AttachmentEntity).save({
        id: attachmentId,
        resource,
        recordId: id,
        field,
        ...input,
        key,
        stagingKey: "",
        expiresAt: new Date(),
        status: "pending",
      });
    });
    // Persist pending metadata before writing S3 so failures remain discoverable by cleanup.
    // Upload is bounded to five minutes; cleanup only considers pending rows after one hour.
    await this.s3.upload(key, file!.buffer, input.mimeType);
    return this.db.transaction(async (manager) => {
      await this.records.find(manager, resource, id, true);
      const repo = manager.getRepository(AttachmentEntity);
      const current = await repo.findOne({
        where: { id: attachmentId },
        lock: { mode: "pessimistic_write" },
      });
      if (!current || current.status !== "pending")
        throw new NotFoundException("Upload no longer available");
      if (!definition.multiple)
        await repo.update(
          { resource, recordId: id, field, status: "ready" },
          { status: "deleted" },
        );
      current.status = "ready";
      await repo.save(current);
      return attachmentMetadata(current);
    });
  }
  private validateFile(
    resource: string,
    field: string,
    file?: UploadedAttachment,
  ) {
    const definition = this.field(resource, field);
    if (!file?.buffer)
      throw new BadRequestException("A multipart file field is required");
    const maxBytes = Math.min(
      definition.maxBytes ?? config.ATTACHMENT_MAX_BYTES,
      config.ATTACHMENT_MAX_BYTES,
    );
    if (file.buffer.length > maxBytes)
      throw new PayloadTooLargeException("Attachment exceeds field size limit");
    const input = parse(
      z.object({
        name: z
          .string()
          .trim()
          .min(1)
          .max(255)
          .refine((v) => !/[\x00-\x1f\x7f/\\]/.test(v), "Invalid filename"),
        mimeType: z
          .string()
          .max(120)
          .refine(
            (v) => definition.mimeTypes.includes(v),
            "Unsupported MIME type",
          ),
        size: z.number().int().min(1),
      }),
      {
        name: file.originalname,
        mimeType: file.mimetype,
        size: file.buffer.length,
      },
    );
    return input;
  }

  /** Standalone import runner; close it after use to release the storage client. */
  static forImport(db: DataSource, registry: ResourceRegistry) {
    const storage = new S3Service();
    return {
      service: new AttachmentService(
        db,
        registry,
        new ResourceRecordStore(registry),
        storage,
      ),
      close: () => storage.onModuleDestroy(),
    };
  }

  importMaxBytes(resource: string, field: string) {
    return Math.min(
      this.field(resource, field).maxBytes ?? config.ATTACHMENT_MAX_BYTES,
      config.ATTACHMENT_MAX_BYTES,
    );
  }

  async hasImported(
    id: string,
    resource: string,
    recordId: string,
    field: string,
  ) {
    return this.db
      .getRepository(AttachmentEntity)
      .existsBy({ id, resource, recordId, field, status: "ready" });
  }

  /** Persist pending metadata outside the row transaction so failed imports remain cleanable. */
  async stageImport(
    resource: string,
    recordId: string,
    field: string,
    file: UploadedAttachment,
  ) {
    const input = this.validateFile(resource, field, file);
    const id = randomUUID();
    const pending = await this.db.getRepository(AttachmentEntity).save({
      id,
      resource,
      recordId,
      field,
      ...input,
      key: `attachments/${resource}/${recordId}/${field}/${id}`,
      stagingKey: "",
      expiresAt: new Date(),
      status: "pending" as const,
    });
    await this.s3.upload(pending.key, file.buffer, input.mimeType);
    return pending.id;
  }

  /** Publish staged metadata atomically with imported rows, using a stable source identity. */
  async commitImport(manager: EntityManager, pendingId: string, id: string) {
    const repo = manager.getRepository(AttachmentEntity);
    const pending = await repo.findOneByOrFail({
      id: pendingId,
      status: "pending",
    });
    const definition = this.field(pending.resource, pending.field);
    const existing = await repo.findOneBy({ id });
    if (existing?.status === "ready") {
      await repo.update({ id: pendingId }, { status: "deleted" });
      return;
    }
    if (!definition.multiple)
      await repo.update(
        {
          resource: pending.resource,
          recordId: pending.recordId,
          field: pending.field,
          status: "ready",
        },
        { status: "deleted" },
      );
    if (existing)
      await repo.save({ ...existing, id: randomUUID(), status: "deleted" });
    await repo.save({ ...pending, id, status: "ready" });
    await repo.delete({ id: pendingId });
  }

  private async findRecord(
    resource: string,
    id: string,
    field: string,
    attachmentId: string,
  ) {
    this.field(resource, field);
    recordId(attachmentId);
    await this.records.find(this.db.manager, resource, id);
    const attachment = await this.db.getRepository(AttachmentEntity).findOneBy({
      id: attachmentId,
      resource,
      recordId: id,
      field,
      status: "ready",
    });
    if (!attachment) throw new NotFoundException("Attachment not found");
    return attachment;
  }
  async find(
    resource: string,
    id: string,
    field: string,
    attachmentId: string,
  ) {
    return attachmentMetadata(
      await this.findRecord(resource, id, field, attachmentId),
    );
  }
  async download(
    resource: string,
    id: string,
    field: string,
    attachmentId: string,
  ) {
    const attachment = await this.findRecord(resource, id, field, attachmentId);
    return {
      attachment: attachmentMetadata(attachment),
      stream: await this.s3.download(attachment.key),
    };
  }
  async remove(
    resource: string,
    id: string,
    field: string,
    attachmentId: string,
  ) {
    this.field(resource, field);
    recordId(attachmentId);
    await this.db.transaction(async (manager) => {
      await this.records.find(manager, resource, id, true);
      const repo = manager.getRepository(AttachmentEntity);
      const attachment = await repo.findOneBy({
        id: attachmentId,
        resource,
        recordId: id,
        field,
      });
      if (!attachment) throw new NotFoundException("Attachment not found");
      await repo.update({ id: attachmentId }, { status: "deleted" });
    });
    return { id: attachmentId, deleted: true };
  }
  async cleanup() {
    // Grace period protects active uploads; legacy staging objects are also cleaned up.
    const cutoff = new Date(Date.now() - 60 * 60 * 1000);
    const candidates = await this.db
      .getRepository(AttachmentEntity)
      .createQueryBuilder("a")
      .where("a.expiresAt < :cutoff", { cutoff })
      .getMany();
    let removed = 0;
    const failures: string[] = [];
    for (const candidate of candidates) {
      try {
        await this.db.transaction(async (manager) => {
          const repo = manager.getRepository(AttachmentEntity);
          const current = await repo.findOne({
            where: { id: candidate.id },
            lock: { mode: "pessimistic_write" },
          });
          if (!current) return;
          if (current.stagingKey) await this.s3.remove(current.stagingKey);
          if (current.status !== "ready") {
            await this.s3.remove(current.key);
            await repo.delete({ id: current.id });
            removed++;
          }
        });
      } catch {
        failures.push(candidate.id);
      }
    }
    return { removed, failures };
  }
}
