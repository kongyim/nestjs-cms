import type { SectionConfig } from "./types";
import { flattenFields } from "../lib/form-layout";

export type AuthSectionExtension = Partial<
  Pick<SectionConfig, "defaults" | "formFields" | "listFields" | "searchFields">
>;
export type AuthSectionExtensions = Partial<
  Record<"users" | "roles", AuthSectionExtension>
>;

function extendSection(
  base: SectionConfig,
  extra?: AuthSectionExtension,
): SectionConfig {
  if (!extra) return base;
  const protectedFields = new Set([
    ...Object.keys(base.defaults),
    ...flattenFields(base.formFields).map((field) => field.field),
    "id",
    "createdAt",
    "updatedAt",
    "attachments",
    "__proto__",
    "constructor",
    "prototype",
  ]);
  for (const field of [
    ...Object.keys(extra.defaults ?? {}),
    ...flattenFields(extra.formFields ?? []).map((field) => field.field),
  ]) {
    if (protectedFields.has(field.split(".")[0]))
      throw new Error(`Cannot override auth field ${base.key}.${field}.`);
  }
  for (const property of ["listFields", "searchFields"] as const) {
    const fields = new Set(base[property].map((field) => field.field));
    for (const field of extra[property] ?? []) {
      if (fields.has(field.field))
        throw new Error(
          `Duplicate ${property} field ${base.key}.${field.field}.`,
        );
      fields.add(field.field);
    }
  }
  return defineSection({
    ...base,
    defaults: { ...base.defaults, ...extra.defaults },
    formFields: [...base.formFields, ...(extra.formFields ?? [])],
    listFields: [...base.listFields, ...(extra.listFields ?? [])],
    searchFields: [...base.searchFields, ...(extra.searchFields ?? [])],
  });
}

import { defineSection } from "../config";
const roleOptions = { resource: "roles", labelField: "name" };
const users = () =>
  defineSection({
    key: "users",
    label: "Users",
    singular: "user",
    description: "Manage accounts, assign roles, and control sign-in access.",
    readPermission: "users:manage",
    writePermission: "users:manage",
    defaults: { email: "", displayName: "", roleId: "", active: true },
    listFields: [
      { field: "displayName", label: "Name" },
      { field: "email", label: "Email" },
      { field: "roleId", label: "Role", itemsFrom: roleOptions },
      { field: "active", label: "Active", type: "boolean" },
    ],
    searchFields: [
      { field: "email", label: "Email", type: "text" },
      {
        field: "active",
        label: "Active",
        type: "select",
        boolean: true,
        items: [
          { value: "true", label: "Active" },
          { value: "false", label: "Inactive" },
        ],
      },
    ],
    formFields: [
      {
        field: "displayName",
        label: "Display name",
        type: "text",
        required: true,
        maxLength: 120,
      },
      {
        field: "email",
        label: "Email",
        type: "email",
        required: true,
        maxLength: 254,
      },
      {
        field: "password",
        label: "Password",
        type: "password",
        minLength: 12,
        maxLength: 128,
        hint: "Use 12–128 characters. Leave blank to keep the current password. New accounts need a password to sign in. Changing it signs this user out of all sessions.",
        passwordAction: {
          path: (id) => `/auth/users/${encodeURIComponent(id)}/password`,
        },
      },
      {
        field: "roleId",
        label: "Role",
        type: "select",
        required: true,
        itemsFrom: roleOptions,
        hint: "Create a role first if no roles are available.",
      },
      {
        field: "active",
        label: "Allow sign-in",
        type: "checkbox",
        hint: "Disabling an account immediately blocks access. Keep an active administrator account available.",
      },
    ],
  });

const roles = (permissions: { value: string; label: string }[]) =>
  defineSection({
    key: "roles",
    label: "Roles",
    singular: "role",
    description: "Define what each team member can access.",
    readPermission: "users:manage",
    writePermission: "users:manage",
    defaults: { name: "", permissions: [] },
    listFields: [
      { field: "name", label: "Name" },
      { field: "permissions", label: "Permissions" },
    ],
    searchFields: [{ field: "name", label: "Name", type: "text" }],
    formFields: [
      {
        field: "name",
        label: "Name",
        type: "text",
        required: true,
        maxLength: 80,
      },
      {
        field: "permissions",
        label: "Permissions",
        type: "checkboxes",
        items: permissions,
        hint: "Editors need both page permissions. User management grants full administrative access. Keep at least one administrator role available.",
      },
    ],
  });

/** Add the built-in user and role editors for @nestjs-cms/auth. */
export function createAuthSections(
  permissions: { value: string; label: string }[],
  extensions: AuthSectionExtensions = {},
) {
  const choices = [...permissions];
  if (!choices.some((permission) => permission.value === "users:manage")) {
    choices.push({
      value: "users:manage",
      label: "Manage users, passwords, and roles",
    });
  }
  return [
    extendSection(roles(choices), extensions.roles),
    extendSection(users(), extensions.users),
  ];
}
