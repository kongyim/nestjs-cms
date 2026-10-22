'use client';
import { createContext, useContext } from 'react';
import type { AdminConfig } from './config';
import type { ApiClient } from './lib/api';
export const AdminContext = createContext<{
  api: ApiClient;
  config: AdminConfig;
} | null>(null);
export function useAdmin() {
  const runtime = useContext(AdminContext);
  if (!runtime)
    throw new Error('Admin components must be rendered inside AdminPortal.');
  return runtime;
}
