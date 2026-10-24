import { z } from "@nestjs-cms/core";

export function unwrap(schema: z.ZodType): z.ZodType {
  while (
    schema instanceof z.ZodOptional ||
    schema instanceof z.ZodNullable ||
    schema instanceof z.ZodDefault
  )
    schema = schema.unwrap() as z.ZodType;
  return schema;
}

export function fieldSchema(schema: z.ZodType, path: string[]): z.ZodType {
  for (const key of path) {
    const object = unwrap(schema);
    if (!(object instanceof z.ZodObject) || !Object.hasOwn(object.shape, key))
      throw new Error("Unknown nested field");
    schema = object.shape[key];
  }
  return schema;
}

export function setPath(
  object: Record<string, unknown>,
  path: string[],
  value: unknown,
) {
  let current = object;
  for (const key of path.slice(0, -1)) {
    const child = current[key];
    if (!child || typeof child !== "object" || Array.isArray(child))
      current[key] = {};
    current = current[key] as Record<string, unknown>;
  }
  current[path[path.length - 1]] = value;
}

export function getPath(
  object: Record<string, unknown>,
  path: string[],
): unknown {
  let current: unknown = object;
  for (const key of path) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

export function stringArray(schema: z.ZodType): boolean {
  const value = unwrap(schema);
  if (!(value instanceof z.ZodArray)) return false;
  const element = unwrap(value.element as z.ZodType);
  return (
    element instanceof z.ZodString ||
    (element instanceof z.ZodEnum &&
      element.options.every((option) => typeof option === "string"))
  );
}

export function cellType(schema: z.ZodType): unknown {
  const value = unwrap(schema);
  if (value instanceof z.ZodBoolean) return Boolean;
  if (value instanceof z.ZodNumber) return Number;
  if (
    value instanceof z.ZodObject ||
    value instanceof z.ZodArray ||
    value instanceof z.ZodRecord
  )
    return "json";
  return String;
}
