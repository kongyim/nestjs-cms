import type { ApiClient } from './api';

// Use the existing DELETE endpoint so resource permissions and hooks still apply.
export async function deleteRecords(
  api: ApiClient,
  resource: string,
  ids: string[],
) {
  const deleted: string[] = [];
  const failed: { id: string; message: string }[] = [];
  for (const id of new Set(ids)) {
    try {
      await api(`/${resource}/${encodeURIComponent(id)}`, { method: 'DELETE' });
      deleted.push(id);
    } catch (error) {
      failed.push({
        id,
        message: error instanceof Error ? error.message : 'Delete failed.',
      });
    }
  }
  return { deleted, failed };
}
