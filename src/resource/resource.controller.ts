import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
  StreamableFile,
  Header,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { config } from "../config";
import type { UploadedAttachment } from "./resource.types";
import { ResourceRegistry } from "./resource.registry";
import { ResourceService } from "./resource.service";
@Controller("api")
export class ResourceController {
  constructor(
    private readonly resources: ResourceService,
    private readonly registry: ResourceRegistry,
  ) {}
  @Get("_resources") describe() {
    return this.registry.describe();
  }
  @Get(":resource") list(
    @Param("resource") resource: string,
    @Query() query: Record<string, unknown>,
  ) {
    return this.resources.list(resource, query);
  }
  @Get(":resource/:id") get(
    @Param("resource") resource: string,
    @Param("id") id: string,
  ) {
    return this.resources.get(resource, id);
  }
  @Post(":resource") create(
    @Param("resource") resource: string,
    @Body() body: unknown,
  ) {
    return this.resources.create(resource, body);
  }
  @Patch(":resource/:id") patch(
    @Param("resource") resource: string,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.resources.update(resource, id, body);
  }
  @Put(":resource/:id") update(
    @Param("resource") resource: string,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.resources.update(resource, id, body);
  }
  @Delete(":resource/:id") delete(
    @Param("resource") resource: string,
    @Param("id") id: string,
  ) {
    return this.resources.delete(resource, id);
  }
  @Post(":resource/:id/attachments/:field")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: config.ATTACHMENT_MAX_BYTES, files: 1, fields: 0 },
    }),
  )
  upload(
    @Param("resource") resource: string,
    @Param("id") id: string,
    @Param("field") field: string,
    @UploadedFile() file?: UploadedAttachment,
  ) {
    return this.resources.createAttachment(resource, id, field, file);
  }
  @Get(":resource/:id/attachments/:field/:attachmentId")
  @Header("Cache-Control", "private, no-store")
  @Header("X-Content-Type-Options", "nosniff")
  async download(
    @Param("resource") resource: string,
    @Param("id") id: string,
    @Param("field") field: string,
    @Param("attachmentId") aid: string,
  ) {
    const { attachment, stream } = await this.resources.downloadAttachment(
      resource,
      id,
      field,
      aid,
    );
    return new StreamableFile(stream, {
      type: attachment.mimeType,
      length: attachment.size,
      disposition: `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(attachment.name).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16))}`,
    });
  }
  @Delete(":resource/:id/attachments/:field/:attachmentId") remove(
    @Param("resource") resource: string,
    @Param("id") id: string,
    @Param("field") field: string,
    @Param("attachmentId") aid: string,
  ) {
    return this.resources.removeAttachment(resource, id, field, aid);
  }
}
