import type { ResourceDefinition } from "@nestjs-cms/core";

/** Additional persisted fields; built-in auth fields cannot be replaced. */
export type AuthResourceExtension = Pick<
  ResourceDefinition,
  "schema" | "columns"
> &
  Partial<Pick<ResourceDefinition, "filterable" | "sortable">>;
export type AuthResourceExtensions = Partial<
  Record<"users" | "roles", AuthResourceExtension>
>;

export function extendAuthResource(
  base: ResourceDefinition,
  extra?: AuthResourceExtension,
): ResourceDefinition {
  if (!extra) return base;
  const reserved = new Set([
    ...Object.keys(base.columns),
    ...Object.keys(base.schema.shape),
    "id",
    "createdAt",
    "updatedAt",
    "attachments",
    "password",
    "passwordHash",
    "__proto__",
    "constructor",
    "prototype",
  ]);
  const fields = Object.keys(extra.schema.shape);
  const columns = Object.keys(extra.columns);
  for (const key of new Set([...fields, ...columns])) {
    if (reserved.has(key))
      throw new Error(`Cannot override auth field ${base.name}.${key}.`);
    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(key))
      throw new Error(`Invalid auth extension field: ${key}`);
    if (
      !Object.hasOwn(extra.schema.shape, key) ||
      !Object.hasOwn(extra.columns, key)
    )
      throw new Error(
        `Auth extension ${base.name}.${key} needs both a schema and a column.`,
      );
    const column = extra.columns[key];
    if (
      column.primary ||
      column.generated ||
      column.createDate ||
      column.updateDate ||
      column.deleteDate ||
      (column.name && column.name !== key)
    )
      throw new Error(
        `Auth extension ${base.name}.${key} must be an ordinary column.`,
      );
    // Bootstrap accounts and existing records must remain valid without host input.
    const omitted = extra.schema.shape[key].safeParse(undefined);
    if (
      !omitted.success ||
      ((omitted.data === undefined || omitted.data === null) &&
        !column.nullable &&
        column.default === undefined)
    )
      throw new Error(
        `Auth extension ${base.name}.${key} needs a schema default or optional schema with a nullable/defaulted column.`,
      );
  }
  for (const field of [
    ...(extra.filterable ?? []),
    ...(extra.sortable ?? []),
  ]) {
    if (
      !Object.hasOwn(base.columns, field) &&
      !Object.hasOwn(extra.columns, field)
    )
      throw new Error(`Unknown auth query field: ${field}`);
  }
  return {
    ...base,
    schema: base.schema.extend(extra.schema.shape),
    columns: { ...base.columns, ...extra.columns },
    filterable: [
      ...new Set([...(base.filterable ?? []), ...(extra.filterable ?? [])]),
    ],
    sortable: [
      ...new Set([...(base.sortable ?? []), ...(extra.sortable ?? [])]),
    ],
  };
}
