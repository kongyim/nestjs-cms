import type { ComponentType } from 'react';
import type { ThemeOptions } from '@mui/material/styles';
import type { FormField, FormValues, SectionConfig } from './configs/types';
import type { ApiClient, AuthAdapter, Identity } from './lib/api';

export type FieldRendererProps = {
  field: FormField;
  values: FormValues;
  disabled: boolean;
  onChange: (values: FormValues) => void;
};
export type AdminConfig = {
  title?: string;
  subtitle?: string;
  loginDescription?: string;
  apiBaseUrl?: string;
  sections: SectionConfig[];
  defaultSection?: string;
  request?: ApiClient;
  auth?: (api: ApiClient) => AuthAdapter;
  canAccess?: (identity: Identity, permission: string | undefined) => boolean;
  fieldRenderers?: Record<string, ComponentType<FieldRendererProps>>;
  attachmentUrl?: (path: string) => string;
  theme?: ThemeOptions;
};

export function defineSection(section: SectionConfig): SectionConfig {
  const fields = new Set<string>();
  for (const field of section.formFields) {
    if (fields.has(field.field))
      throw new Error(`Duplicate field ${field.field} in ${section.key}.`);
    if (field.type === 'password' && !field.passwordAction)
      throw new Error(`Password field ${field.field} needs passwordAction.`);
    fields.add(field.field);
  }
  return section;
}

export function defineAdmin(config: AdminConfig): AdminConfig {
  const keys = new Set<string>();
  for (const section of config.sections) {
    defineSection(section);
    if (!/^[a-z][a-z0-9_]*$/.test(section.key))
      throw new Error(`Invalid section key: ${section.key}`);
    if (keys.has(section.key))
      throw new Error(`Duplicate section: ${section.key}`);
    keys.add(section.key);
  }
  if (config.defaultSection && !keys.has(config.defaultSection))
    throw new Error(`Unknown default section: ${config.defaultSection}`);
  return {
    ...config,
    sections: [...config.sections],
  };
}
