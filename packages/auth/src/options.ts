import type { AuthResourceExtensions } from "./resource-extension";
import type { ResourceDefinition } from "@nestjs-cms/core";
import { z } from "@nestjs-cms/core";

export interface CmsAuthOptions {
  resourcesPath?: string;
  extension?: ".ts" | ".js";
  resources?: ResourceDefinition[];
  /** Add fields to the built-in users and roles without replacing auth fields. */
  resourceExtensions?: AuthResourceExtensions;
  /** Exact browser origin, without the admin path. */
  adminOrigin: string;
  /** Browser-facing admin prefix. Defaults to /admin; use '' for the root. */
  adminBasePath?: string;
  bootstrapAdmin?: { email: string; password: string; displayName?: string };
  /** Override the default <resource>:read / <resource>:write permissions. */
  resourcePermissions?: Record<string, { read: string; write: string }>;
  /** Additional permission names for application-specific controllers or UI. */
  permissions?: string[];
  sessionLifetimeMs?: number;
}

export const AUTH_OPTIONS = Symbol("CMS_AUTH_OPTIONS");
export interface ResolvedAuthOptions {
  adminOrigin: string;
  cookiePath: string;
  sessionLifetimeMs: number;
  bootstrapAdmin?: CmsAuthOptions["bootstrapAdmin"];
  resourcePermissions: Record<string, { read: string; write: string }>;
  permissions: string[];
}

export function resolveOptions(
  options: CmsAuthOptions,
  resources: ResourceDefinition[],
): ResolvedAuthOptions {
  const origin = new URL(options.adminOrigin);
  if (
    !["http:", "https:"].includes(origin.protocol) ||
    origin.origin !== options.adminOrigin
  ) {
    throw new Error(
      "adminOrigin must be an exact HTTP(S) origin without a path.",
    );
  }
  if (process.env.NODE_ENV === "production" && origin.protocol !== "https:") {
    throw new Error("Production adminOrigin must use HTTPS.");
  }
  const basePath = (options.adminBasePath ?? "/admin").replace(/\/+$/, "");
  if (basePath && !/^(\/[a-zA-Z0-9_-]+)+$/.test(basePath))
    throw new Error("Invalid adminBasePath.");
  const lifetime = options.sessionLifetimeMs ?? 8 * 60 * 60 * 1000;
  if (
    !Number.isSafeInteger(lifetime) ||
    lifetime < 60_000 ||
    lifetime > 30 * 24 * 60 * 60 * 1000
  ) {
    throw new Error(
      "sessionLifetimeMs must be between one minute and 30 days.",
    );
  }
  const names = new Set<string>();
  const resourcePermissions: ResolvedAuthOptions["resourcePermissions"] =
    Object.create(null);
  for (const resource of resources) {
    if (
      [
        "users",
        "roles",
        "auth",
        "admin_credentials",
        "admin_sessions",
      ].includes(resource.name)
    ) {
      throw new Error(`Reserved auth resource name: ${resource.name}`);
    }
    if (names.has(resource.name))
      throw new Error(`Duplicate resource name: ${resource.name}`);
    names.add(resource.name);
    resourcePermissions[resource.name] = options.resourcePermissions?.[
      resource.name
    ] ?? {
      read: `${resource.name}:read`,
      write: `${resource.name}:write`,
    };
  }
  for (const name of Object.keys(options.resourcePermissions ?? {})) {
    if (!names.has(name))
      throw new Error(`Permission mapping refers to unknown resource: ${name}`);
  }
  resourcePermissions.users = resourcePermissions.roles = {
    read: "users:manage",
    write: "users:manage",
  };
  const permissions = [
    ...new Set([
      "users:manage",
      ...(options.permissions ?? []),
      ...Object.values(resourcePermissions).flatMap((value) => [
        value.read,
        value.write,
      ]),
    ]),
  ];
  if (
    permissions.some(
      (value) =>
        typeof value !== "string" ||
        !/^[a-z][a-z0-9_-]*:[a-z][a-z0-9_-]*$/.test(value),
    )
  ) {
    throw new Error("Permissions must have the form resource:action.");
  }
  if (options.bootstrapAdmin) {
    const valid = z
      .object({
        email: z.string().trim().toLowerCase().email().max(254),
        password: z.string().min(12).max(128),
        displayName: z.string().trim().min(1).max(120).optional(),
      })
      .safeParse(options.bootstrapAdmin);
    if (!valid.success)
      throw new Error(
        "Invalid bootstrap administrator: provide an email and a password of 12–128 characters.",
      );
    options = { ...options, bootstrapAdmin: valid.data };
  }
  return {
    adminOrigin: options.adminOrigin,
    cookiePath: `${basePath}/api`,
    sessionLifetimeMs: lifetime,
    bootstrapAdmin: options.bootstrapAdmin,
    resourcePermissions,
    permissions,
  };
}
