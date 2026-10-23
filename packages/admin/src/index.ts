"use client";
export { default as AdminPortal } from "./admin-portal";
export { default as AdminTheme } from "./components/theme-provider";
export { defineAdmin, defineSection, defineCustomSection } from "./config";
export type { AdminConfig, FieldRendererProps } from "./config";
export type {
  SectionConfig,
  CustomSectionConfig,
  AdminSectionConfig,
  FormField,
  FormItem,
  FieldGroup,
  FieldWidth,
  ColumnSpan,
  FormValues,
  FieldValue,
  ResourceRecord,
  ResourceList,
  Option,
} from "./configs/types";
export { createApiClient, createSessionAuth } from "./lib/api";
export type { ApiClient, ApiOptions, AuthAdapter, Identity } from "./lib/api";

export { useAdmin } from "./runtime";

export { createAuthSections } from "./configs/auth";
