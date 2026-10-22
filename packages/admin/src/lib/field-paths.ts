import type { FieldValue, FormValues } from '../configs/types';

function parts(path: string): string[] {
  const keys = path.split('.');
  if (
    keys.some(
      (key) => !key || ['__proto__', 'constructor', 'prototype'].includes(key),
    )
  ) {
    throw new Error(`Invalid field path: ${path}`);
  }
  return keys;
}

function isObject(value: FieldValue | undefined): value is FormValues {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function readFieldPath(
  values: FormValues | null | undefined,
  path: string,
): FieldValue | undefined {
  let value: FieldValue | undefined = values ?? undefined;
  for (const key of parts(path)) {
    if (!isObject(value) || !Object.prototype.hasOwnProperty.call(value, key))
      return undefined;
    value = value[key];
  }
  return value;
}

// The API replaces JSON columns wholesale. Preserve unedited siblings while
// constructing nested objects, without mutating the record or section defaults.
export function nestFieldValues(
  entries: [string, FieldValue][],
  base: FormValues,
): FormValues {
  const payload: FormValues = {};
  for (const [path, value] of entries) {
    const keys = parts(path);
    let target = payload;
    let source: FieldValue | undefined = base;
    for (const key of keys.slice(0, -1)) {
      const existing: FieldValue | undefined =
        Object.prototype.hasOwnProperty.call(target, key)
          ? target[key]
          : isObject(source)
            ? source[key]
            : undefined;
      if (existing != null && !isObject(existing))
        throw new Error(`Field path ${path} must refer to a JSON object.`);
      const child = { ...(isObject(existing) ? existing : {}) };
      target[key] = child;
      target = child;
      source = existing;
    }
    target[keys[keys.length - 1]] = value;
  }
  return payload;
}
