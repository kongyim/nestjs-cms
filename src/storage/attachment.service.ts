import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { DataSource } from "typeorm";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { config } from "../config";
import { ResourceRegistry } from "../resource/resource.registry";
import { ResourceService } from "../resource/resource.service";
import { parse, recordId } from "../resource/validation";
import { AttachmentEntity, attachmentMetadata } from "./attachment.entity";
import { S3Service } from "./s3.service";
@Injectable()
export class AttachmentService {
  constructor(
    private readonly db: DataSource,
    private readonly registry: ResourceRegistry,
    private readonly records: ResourceService,
    private readonly s3: S3Service,
  ) {}
  private field(resource: string, field: string) {
    const definition = this.registry
      .get(resource)
      .attachments?.find((f) => f.field === field);
    if (!definition) throw new BadRequestException("Unknown attachment field");
    return definition;
  }
  async initiate(resource: string, id: string, field: string, body: unknown) {
    const definition = this.field(resource, field);
    const input = parse(
      z
        .object({
          name: z
            .string()
            .trim()
            .min(1)
            .max(255)
            .refine(
              (v) => !/[\x00-\x1f\x7f/\\]/.test(v),
              "Use a filename without path or control characters",
            ),
          mimeType: z
            .string()
            .max(120)
            .refine(
              (v) => definition.mimeTypes.includes(v),
              "Unsupported MIME type",
            ),
          size: z
            .number()
            .int()
            .min(1)
            .max(
              Math.min(
                definition.maxBytes ?? config.ATTACHMENT_MAX_BYTES,
                config.ATTACHMENT_MAX_BYTES,
              ),
            ),
        })
        .strict(),
      body,
    );
    const attachmentId = randomUUID();
    const stagingKey = `staging/${attachmentId}`;
    const key = `attachments/${resource}/${id}/${field}/${attachmentId}`;
    const expiresAt = new Date(Date.now() + config.S3_URL_TTL_SECONDS * 1000);
    const url = await this.s3.uploadUrl(stagingKey, input.mimeType, input.size);
    await this.db.transaction(async (manager) => {
      await this.records.find(manager, resource, id, true);
      await manager.getRepository(AttachmentEntity).save({
        id: attachmentId,
        resource,
        recordId: id,
        field,
        ...input,
        stagingKey,
        key,
        expiresAt,
        status: "pending",
      });
    });
    return {
      id: attachmentId,
      method: "PUT",
      url,
      headers: { "Content-Type": input.mimeType },
      expiresAt,
    };
  }
  async complete(
    resource: string,
    id: string,
    field: string,
    attachmentId: string,
  ) {
    const definition = this.field(resource, field);
    recordId(attachmentId);
    return this.db.transaction(async (manager) => {
      // All mutation paths lock the parent first to serialize replacements, deletes and completions.
      await this.records.find(manager, resource, id, true);
      const repo = manager.getRepository(AttachmentEntity);
      const attachment = await repo.findOne({
        where: { id: attachmentId, resource, recordId: id, field },
        lock: { mode: "pessimistic_write" },
      });
      if (!attachment || attachment.status === "deleted")
        throw new NotFoundException("Upload not found");
      if (attachment.status === "ready") return attachmentMetadata(attachment);
      if (attachment.expiresAt.getTime() <= Date.now())
        throw new BadRequestException("Upload expired; request a new upload");
      let head;
      try {
        head = await this.s3.head(attachment.stagingKey);
      } catch (error) {
        if (
          (error as { $metadata?: { httpStatusCode?: number } }).$metadata
            ?.httpStatusCode === 404
        )
          throw new BadRequestException(
            "Upload has not reached object storage",
          );
        throw new ServiceUnavailableException("Object storage unavailable");
      }
      if (
        head.ContentLength !== attachment.size ||
        head.ContentType !== attachment.mimeType ||
        !head.ETag
      )
        throw new BadRequestException(
          "Uploaded object size or MIME type does not match",
        );
      // The final key is never exposed for upload. ETag precondition prevents a HEAD/copy race.
      await this.s3.copy(attachment.stagingKey, attachment.key, head.ETag);
      if (!definition.multiple)
        await repo.update(
          { resource, recordId: id, field, status: "ready" },
          { status: "deleted" },
        );
      attachment.status = "ready";
      await repo.save(attachment);
      // Staging remains until expiry, because a presigned URL can be replayed before then.
      return attachmentMetadata(attachment);
    });
  }
  async download(
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
    return {
      ...attachmentMetadata(attachment),
      url: await this.s3.downloadUrl(attachment.key, attachment.name),
      expiresIn: config.S3_URL_TTL_SECONDS,
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
    // Grace period covers slow in-flight uploads. Also configure a staging/ lifecycle policy.
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
          await this.s3.remove(current.stagingKey);
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
