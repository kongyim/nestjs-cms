import "reflect-metadata";
export { z } from "zod";
export { ResourceModule } from "./resource/resource.module";
export type { ResourceModuleOptions } from "./resource/resource.module";
export { ResourceService } from "./resource/resource.service";
export { ResourceRegistry } from "./resource/resource.registry";
export { defineResource } from "./resource/resource.types";
export type {
  ResourceDefinition,
  ResourceHook,
  HookContext,
  HookAction,
  RecordData,
  AttachmentField,
  UploadedAttachment,
} from "./resource/resource.types";
export { loadResources } from "./resource/resource.loader";
export { createCmsDataSource } from "./database/create-data-source";
export { AttachmentService } from "./storage/attachment.service";
export { configureCmsApp } from "./setup";
