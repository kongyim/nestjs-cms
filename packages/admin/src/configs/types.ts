import type { ComponentType } from 'react';

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
export type ColumnSpan = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
export type FieldWidth =
  | ColumnSpan
  | {
      xs?: ColumnSpan;
      sm?: ColumnSpan;
      md?: ColumnSpan;
      lg?: ColumnSpan;
      xl?: ColumnSpan;
    };
export type FieldGroup = {
  type: 'group';
  key: string;
  label: string;
  description?: string;
  width?: FieldWidth;
  fields: FormItem[];
};
export type FormItem = FormField | FieldGroup;
export type FormField = {
  width?: FieldWidth;
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
  type?: 'resource';
  key: string;
  label: string;
  singular: string;
  description: string;
  readPermission?: string;
  writePermission?: string;
  defaults: FormValues;
  listFields: {
    field: string;
    label: string;
    type?: 'date' | 'boolean' | 'attachment';
    itemsFrom?: { resource: string; labelField: string };
  }[];
  searchFields: {
    field: string;
    label: string;
    type: 'text' | 'select';
    items?: Option[];
    boolean?: boolean;
  }[];
  formFields: FormItem[];
};

/** A custom page rendered inside the authenticated admin shell. */
export type CustomSectionConfig = {
  type: 'custom';
  key: string;
  label: string;
  description?: string;
  readPermission?: string;
  component: ComponentType;
};

export type AdminSectionConfig = SectionConfig | CustomSectionConfig;
