export type FieldValue =
  | string
  | number
  | boolean
  | FieldValue[]
  | { [key: string]: FieldValue }
  | null;
export type FormValues = Record<string, FieldValue>;
export type ResourceRecord = FormValues & { id: string };
export type ResourceList = {
  data: ResourceRecord[];
  meta: { page: number; total: number; totalPages: number };
};
export type Option = { value: string; label: string };
export type FormField = {
  field: string;
  label: string;
  type:
    | 'text'
    | 'email'
    | 'password'
    | 'url'
    | 'textarea'
    | 'number'
    | 'date'
    | 'datetime-local'
    | 'json'
    | 'select'
    | 'checkbox'
    | 'checkboxes'
    | 'attachment'
    | (string & {});
  accept?: string;
  multiple?: boolean;
  serialize?: (value: FieldValue, values: FormValues) => FieldValue;
  required?: boolean;
  nullable?: boolean;
  minLength?: number;
  maxLength?: number;
  passwordAction?: { path: (id: string) => string };
  min?: number;
  max?: number;
  step?: number;
  hint?: string;
  items?: Option[];
  itemsFrom?: { resource: string; labelField: string };
};
export type SectionConfig = {
  key: string;
  order?: number;
  label: string;
  singular: string;
  description: string;
  readPermission?: string;
  writePermission?: string;
  defaults: FormValues;
  listFields: {
    field: string;
    label: string;
    type?: 'date' | 'boolean';
    itemsFrom?: { resource: string; labelField: string };
  }[];
  searchFields: {
    field: string;
    label: string;
    type: 'text' | 'select';
    items?: Option[];
    boolean?: boolean;
  }[];
  formFields: FormField[];
};
