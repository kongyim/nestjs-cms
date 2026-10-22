import type { FormField, FormValues } from '../configs/types';

// Passwords are write-only actions, excluded from the resource JSON payload.
export function passwordChanges(fields: FormField[], values: FormValues) {
  return fields.flatMap((field) => {
    if (field.type !== 'password') return [];
    const password = values[field.field];
    if (password == null || password === '') return [];
    if (typeof password !== 'string')
      throw new Error(`${field.label} must be text.`);
    if (
      (field.minLength !== undefined && password.length < field.minLength) ||
      (field.maxLength !== undefined && password.length > field.maxLength)
    ) {
      throw new Error(`${field.label} does not meet the required length.`);
    }
    if (!field.passwordAction)
      throw new Error(`${field.label} has no password action configured.`);
    // Preserve whitespace: a password must never be trimmed like ordinary text.
    return [{ field: field.field, password, path: field.passwordAction.path }];
  });
}
