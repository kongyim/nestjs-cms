'use client';

import { useState } from 'react';
import { Box, Typography } from '@mui/material';
import type { ResourceRecord } from '../configs/types';
import type { Attachment, Attachments } from '../lib/attachments';
import { useAdmin } from '../runtime';

function Thumbnail({ file, url }: { file: Attachment; url: string }) {
  const [failedUrl, setFailedUrl] = useState<string>();
  if (!file.mimeType?.startsWith('image/') || failedUrl === url) {
    return (
      <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
        {file.name}
        {failedUrl === url ? ' (preview unavailable)' : ''}
      </Typography>
    );
  }
  return (
    <Box
      component="img"
      src={url}
      alt={file.name}
      title={file.name}
      loading="lazy"
      onError={() => setFailedUrl(url)}
      sx={{
        display: 'block',
        width: 72,
        height: 54,
        objectFit: 'contain',
        borderRadius: 1,
        bgcolor: 'action.hover',
      }}
    />
  );
}

export default function AttachmentListCell({
  resource,
  record,
  field,
}: {
  resource: string;
  record: ResourceRecord;
  field: string;
}) {
  const { config } = useAdmin();
  const value = record[field] as Attachments[string] | undefined;
  const files = Array.isArray(value) ? value : value ? [value] : [];
  if (!files.length) return <>—</>;
  return (
    <Box
      sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}
    >
      {files.map((file) => {
        const path = `/${resource}/${encodeURIComponent(record.id)}/attachments/${encodeURIComponent(field)}/${encodeURIComponent(file.id)}`;
        const url =
          config.attachmentUrl?.(path) ??
          `${(config.apiBaseUrl ?? '/api').replace(/\/$/, '')}${path}`;
        return <Thumbnail key={file.id} file={file} url={url} />;
      })}
    </Box>
  );
}
