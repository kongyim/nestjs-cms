import {
  EntityManager,
  EntitySchemaColumnOptions,
  EntitySchemaOptions,
} from "typeorm";
import { z } from "zod";
export type RecordData = Record<string, unknown>;
export type HookAction =
  | "onBeforeCreate"
  | "onAfterCreate"
  | "onBeforeUpdate"
  | "onAfterUpdate"
  | "onBeforeDelete"
  | "onAfterDelete";
export interface HookContext {
  manager: EntityManager;
  resource: string;
  action: HookAction;
  id: string;
  record: RecordData;
  previous?: RecordData;
}
export type ResourceHook = (
  context: HookContext,
) => void | RecordData | Promise<void | RecordData>;
export interface AttachmentField {
  field: string;
  multiple?: boolean;
  maxBytes?: number;
  mimeTypes: string[];
}
export interface ResourceDefinition {
  name: string;
  label?: string;
  schema: z.ZodObject;
  // Explicit update schema allows cross-field refinements without partial() losing invariants.
  updateSchema?: z.ZodType;
  columns: Record<string, EntitySchemaColumnOptions>;
  foreignKeys?: EntitySchemaOptions<RecordData>["foreignKeys"];
  filterable?: string[];
  sortable?: string[];
  attachments?: AttachmentField[];
  hooks?: Partial<Record<HookAction, ResourceHook[]>>;
}
export function defineResource(
  definition: ResourceDefinition,
): ResourceDefinition {
  return definition;
}

export type { UploadedAttachment } from "../storage/attachment.types";
