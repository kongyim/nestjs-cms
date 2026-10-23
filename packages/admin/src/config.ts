import { flattenFields, validateLayout } from './lib/form-layout';
import type { ComponentType } from 'react';
import type { ThemeOptions } from '@mui/material/styles';
import type {
  AdminSectionConfig,
  CustomSectionConfig,
  FormField,
  FormValues,
  SectionConfig,
} from './configs/types';
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
  sections: AdminSectionConfig[];
  defaultSection?: string;
  request?: ApiClient;
  auth?: (api: ApiClient) => AuthAdapter;
  canAccess?: (identity: Identity, permission: string | undefined) => boolean;
  fieldRenderers?: Record<string, ComponentType<FieldRendererProps>>;
  attachmentUrl?: (path: string) => string;
  theme?: ThemeOptions;
  /** Optional server-side import action below section navigation. */
  databaseImport?: { path?: string; label?: string; permission?: string };
};

export function defineSection(section: SectionConfig): SectionConfig {
  validateLayout(section.formFields);
  const fields = new Set<string>();
  for (const field of flattenFields(section.formFields)) {
    if (fields.has(field.field))
      throw new Error(`Duplicate field ${field.field} in ${section.key}.`);
    if (field.type === 'password' && !field.passwordAction)
      throw new Error(`Password field ${field.field} needs passwordAction.`);
    fields.add(field.field);
  }
  return section;
}

export function defineCustomSection(
  section: Omit<CustomSectionConfig, 'type'>,
): CustomSectionConfig {
  if (!section.component)
    throw new Error(`Custom section ${section.key} needs a component.`);
  return { ...section, type: 'custom' };
}

export function defineAdmin(config: AdminConfig): AdminConfig {
  const keys = new Set<string>();
  for (const section of config.sections) {
    if (section.type === 'custom') defineCustomSection(section);
    else defineSection(section);
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
