'use client';
import { createContext, useContext, useMemo } from 'react';
import type { AdminConfig } from './config';
import type { ApiClient } from './lib/api';
import { useNotifications } from './components/notifications';
export const AdminContext = createContext<{
  api: ApiClient;
  config: AdminConfig;
} | null>(null);
export function useAdmin() {
  const runtime = useContext(AdminContext);
  const notify = useNotifications();
  const value = useMemo(
    () => (runtime ? { ...runtime, notify } : null),
    [runtime, notify],
  );
  if (!value)
    throw new Error('Admin components must be rendered inside AdminPortal.');
  return value;
}
