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
) {
  const choices = [...permissions];
  if (!choices.some((permission) => permission.value === "users:manage")) {
    choices.push({
      value: "users:manage",
      label: "Manage users, passwords, and roles",
    });
  }
  return [roles(choices), users()];
}
