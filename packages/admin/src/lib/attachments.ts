import type { ResourceRecord } from '../configs/types';
import type { ApiClient } from './api';

export type Attachment = {
  id: string;
  name: string;
  mimeType?: string;
  size?: number;
};
export type AttachmentChange =
  | { field: string; kind: 'upload'; file: File; multiple: boolean }
  | { field: string; kind: 'remove'; id: string };
export type Attachments = Record<string, Attachment | Attachment[] | null>;

// Acknowledge each successful request so retries only apply remaining changes.
export async function saveAttachments(
  api: ApiClient,
  resource: string,
  record: ResourceRecord,
  changes: AttachmentChange[],
  onSaved: (change: AttachmentChange, record: ResourceRecord) => void,
): Promise<ResourceRecord> {
  for (const change of changes) {
    const path = `/${resource}/${encodeURIComponent(record.id)}/attachments/${encodeURIComponent(change.field)}`;
    const attachments = { ...(record.attachments as Attachments | undefined) };
    const current = attachments[change.field];
    if (change.kind === 'upload') {
      const body = new FormData();
      body.append('file', change.file);
      const uploaded = await api<Attachment>(path, { method: 'POST', body });
      attachments[change.field] = change.multiple
        ? [...(Array.isArray(current) ? current : []), uploaded]
        : uploaded;
    } else {
      await api(`${path}/${encodeURIComponent(change.id)}`, {
        method: 'DELETE',
      });
      attachments[change.field] = Array.isArray(current)
        ? current.filter((file) => file.id !== change.id)
        : null;
    }
    record = { ...record, attachments };
    onSaved(change, record);
  }
  return record;
}
