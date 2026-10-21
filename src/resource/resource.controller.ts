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
} from "@nestjs/common";
import { ResourceRegistry } from "./resource.registry";
import { ResourceService } from "./resource.service";
import { AttachmentService } from "../storage/attachment.service";
@Controller("api")
export class ResourceController {
  constructor(
    private readonly resources: ResourceService,
    private readonly registry: ResourceRegistry,
    private readonly attachments: AttachmentService,
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
  @Post(":resource/:id/attachments/:field/uploads") upload(
    @Param("resource") resource: string,
    @Param("id") id: string,
    @Param("field") field: string,
    @Body() body: unknown,
  ) {
    return this.attachments.initiate(resource, id, field, body);
  }
  @Post(":resource/:id/attachments/:field/:attachmentId/complete") complete(
    @Param("resource") resource: string,
    @Param("id") id: string,
    @Param("field") field: string,
    @Param("attachmentId") aid: string,
  ) {
    return this.attachments.complete(resource, id, field, aid);
  }
  @Get(":resource/:id/attachments/:field/:attachmentId") download(
    @Param("resource") resource: string,
    @Param("id") id: string,
    @Param("field") field: string,
    @Param("attachmentId") aid: string,
  ) {
    return this.attachments.download(resource, id, field, aid);
  }
  @Delete(":resource/:id/attachments/:field/:attachmentId") remove(
    @Param("resource") resource: string,
    @Param("id") id: string,
    @Param("field") field: string,
    @Param("attachmentId") aid: string,
  ) {
    return this.attachments.remove(resource, id, field, aid);
  }
}
