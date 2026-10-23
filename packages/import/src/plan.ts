import { createHash } from "node:crypto";
import type { ResourceRegistry } from "@nestjs-cms/core";
import type { SheetRows } from "./sheets";

export interface ImportRow {
  resource: string;
  key: string;
  row: number;
  id: string;
  data: Record<string, unknown>;
  references: { field: string; resource: string; key: string; id: string }[];
}

/** Stable UUIDv5 in the URL namespace; no tracking table or extra resource column required. */
export function importRecordId(
  spreadsheetId: string,
  resource: string,
  key: string,
): string {
  const namespace = Buffer.from("6ba7b8119dad11d180b400c04fd430c8", "hex");
  const bytes = createHash("sha1")
    .update(namespace)
    .update(JSON.stringify(["nestjs-cms-import", spreadsheetId, resource, key]))
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
const empty = (value: unknown) =>
  value === undefined || value === null || value === "";
function decode(value: unknown, type: unknown): unknown {
  if (value === "null") return null;
  if (type === Boolean || type === "boolean" || type === "bool") {
    if (value === true || value === "true" || value === "TRUE") return true;
    if (value === false || value === "false" || value === "FALSE") return false;
    throw new Error("expected true or false");
  }
  if (
    type === Number ||
    [
      "int",
      "integer",
      "float",
      "double",
      "decimal",
      "numeric",
      "real",
      "smallint",
    ].includes(String(type))
  ) {
    const number = Number(value);
    if (
      !Number.isFinite(number) ||
      typeof value === "boolean" ||
      String(value).trim() === ""
    )
      throw new Error("expected a number");
    return number;
  }
  if (type === "json" || type === "jsonb" || type === "simple-json") {
    if (typeof value !== "string") throw new Error("expected JSON text");
    return JSON.parse(value);
  }
  return String(value);
}

export function planImport(
  sheets: SheetRows,
  registry: ResourceRegistry,
  spreadsheetId: string,
  maxRows = 10000,
): ImportRow[] {
  const rows: ImportRow[] = [];
  const ids = new Set<string>();
  for (const [resource, values] of Object.entries(sheets)) {
    const definition = registry.get(resource);
    if (!values.length || values.every((row) => row.every(empty))) continue;
    const headers = values[0].map((value) => String(value ?? "").trim());
    if (headers.filter((h) => h === "_key").length !== 1)
      throw new Error(`${resource}: exactly one _key column is required.`);
    const fields = new Set<string>();
    const columns = headers.map((header) => {
      if (!header) return null;
      if (header === "_key") return { field: "_key" };
      const parts = header.split("@");
      const [field, target] = parts;
      if (
        parts.length > 2 ||
        !Object.hasOwn(definition.columns, field) ||
        !Object.hasOwn(definition.schema.shape, field) ||
        fields.has(field)
      )
        throw new Error(`${resource}: unknown or duplicate column ${header}.`);
      fields.add(field);
      if (parts.length === 2) {
        registry.get(target);
        const fk = definition.foreignKeys?.find(
          (fk) =>
            fk.columnNames.length === 1 &&
            fk.columnNames[0] === field &&
            fk.target === target &&
            fk.referencedColumnNames?.[0] === "id",
        );
        if (!fk)
          throw new Error(
            `${resource}: ${header} must match a declared foreign key to id.`,
          );
      }
      return { field, target };
    });
    for (let index = 1; index < values.length; index++) {
      const cells = values[index];
      if (cells.every(empty)) continue;
      const rawKey = cells[headers.indexOf("_key")];
      if (typeof rawKey !== "string" && typeof rawKey !== "number")
        throw new Error(`${resource} row ${index + 1}: _key is required.`);
      const key = String(rawKey).trim();
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,119}$/.test(key))
        throw new Error(
          `${resource} row ${index + 1}: _key must use letters, numbers, dots, underscores or hyphens.`,
        );
      const id = importRecordId(spreadsheetId, resource, key);
      if (ids.has(id))
        throw new Error(`${resource} row ${index + 1}: duplicate _key ${key}.`);
      ids.add(id);
      const row: ImportRow = {
        resource,
        key,
        row: index + 1,
        id,
        data: {},
        references: [],
      };
      for (let column = 0; column < cells.length; column++) {
        const value = cells[column];
        if (empty(value)) continue;
        const header = columns[column];
        if (!header)
          throw new Error(
            `${resource} row ${index + 1}: value under an empty/missing header.`,
          );
        if (header.field === "_key") continue;
        try {
          if (header.target && value !== "null") {
            const refKey = String(value).trim();
            const ref = {
              field: header.field,
              resource: header.target,
              key: refKey,
              id: importRecordId(spreadsheetId, header.target, refKey),
            };
            row.references.push(ref);
            row.data[header.field] = ref.id;
          } else
            row.data[header.field] = decode(
              value,
              definition.columns[header.field].type,
            );
        } catch {
          throw new Error(
            `${resource} row ${index + 1}, ${headers[column]}: invalid cell value.`,
          );
        }
      }
      rows.push(row);
      if (rows.length > maxRows)
        throw new Error(`Import exceeds the ${maxRows} row limit.`);
    }
  }
  return rows;
}

/** Sort individual records, allowing references within the same tab. Cycles are rejected. */
export function orderRows(rows: ImportRow[]): ImportRow[] {
  const pending = new Map(rows.map((row) => [row.id, row]));
  const output: ImportRow[] = [];
  while (pending.size) {
    const ready = [...pending.values()].filter((row) =>
      row.references.every((ref) => !pending.has(ref.id)),
    );
    if (!ready.length)
      throw new Error(
        "Circular sheet references: break the cycle before importing.",
      );
    for (const row of ready) {
      pending.delete(row.id);
      output.push(row);
    }
  }
  return output;
}
