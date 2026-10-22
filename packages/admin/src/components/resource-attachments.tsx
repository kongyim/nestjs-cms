'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  FormControl,
  FormHelperText,
  FormLabel,
  Typography,
} from '@mui/material';
import type { ResourceRecord, FormField } from '../configs/types';
import { useAdmin } from '../runtime';
import type { Attachments, AttachmentChange } from '../lib/attachments';

function FilePreview({
  name,
  mimeType,
  url,
  file,
}: {
  name: string;
  mimeType?: string;
  url?: string;
  file?: File;
}) {
  const [localUrl, setLocalUrl] = useState<string>();
  const [failed, setFailed] = useState(false);
  const isImage = (mimeType || file?.type || '').startsWith('image/');
  useEffect(() => {
    setFailed(false);
    if (!file || !isImage) return;
    const objectUrl = URL.createObjectURL(file);
    setLocalUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file, url, isImage]);
  const src = file ? localUrl : url;
  return (
    <Box
      sx={{
        width: 88,
        height: 72,
        flexShrink: 0,
        borderRadius: 1.5,
        overflow: 'hidden',
        bgcolor: 'action.hover',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {isImage && src && !failed ? (
        <img
          src={src}
          alt={name}
          onError={() => setFailed(true)}
          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
        />
      ) : (
        <Typography variant="caption" color="text.secondary">
          {failed ? 'No preview' : isImage ? 'Loading…' : 'FILE'}
        </Typography>
      )}
    </Box>
  );
}

function fileSize(size?: number) {
  if (size == null) return '';
  return size < 1024 * 1024
    ? `${Math.max(1, Math.round(size / 1024))} KB`
    : `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ResourceAttachments({
  resource,
  field,
  record,
  canWrite,
  changes,
  disabled,
  onChange,
}: {
  resource: string;
  field: FormField;
  record: ResourceRecord | null;
  canWrite: boolean;
  changes: AttachmentChange[];
  disabled: boolean;
  onChange: (changes: AttachmentChange[]) => void;
}) {
  const { config } = useAdmin();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  const attachments = record?.attachments as Attachments | undefined;
  const value = attachments?.[field.field];
  const files = Array.isArray(value) ? value : value ? [value] : [];
  const path = `/${resource}/${encodeURIComponent(record?.id ?? '')}/attachments/${encodeURIComponent(field.field)}`;
  const uploads = changes.filter(
    (change) => change.field === field.field && change.kind === 'upload',
  );
  const accepted =
    field.accept
      ?.split(',')
      .map((type) => type.trim())
      .filter(Boolean) ?? [];
  const formats = accepted
    .map((type) =>
      type.startsWith('.')
        ? type.slice(1).toUpperCase()
        : type.split('/')[1]?.toUpperCase(),
    )
    .join(', ');

  function stage(selected: File[]) {
    if (disabled || !canWrite || !selected.length) return;
    setError('');
    if (!field.multiple && selected.length > 1) {
      setError('Choose one file for this field.');
      return;
    }
    const invalid = selected.find(
      (file) =>
        accepted.length &&
        !accepted.some((type) =>
          type.startsWith('.')
            ? file.name.toLowerCase().endsWith(type.toLowerCase())
            : type.endsWith('/*')
              ? file.type.startsWith(type.slice(0, -1))
              : file.type === type,
        ),
    );
    if (invalid) {
      setError(
        `“${invalid.name}” is not a supported file type. Choose ${formats}.`,
      );
      return;
    }
    const pending = field.multiple
      ? changes
      : changes.filter(
          (change) => change.field !== field.field || change.kind !== 'upload',
        );
    onChange([
      ...pending,
      ...selected.map((file): AttachmentChange => ({
        kind: 'upload',
        field: field.field,
        file,
        multiple: !!field.multiple,
      })),
    ]);
  }

  const cardStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: 2,
    p: 1.5,
    border: '1px solid',
    borderColor: 'divider',
    borderRadius: 2,
    flexWrap: 'wrap',
  } as const;

  return (
    <FormControl component="fieldset" disabled={disabled} className="space-y-3">
      <FormLabel component="legend">{field.label}</FormLabel>
      {files.map((file) => {
        const removal = changes.find(
          (change) =>
            change.kind === 'remove' &&
            change.field === field.field &&
            change.id === file.id,
        );
        const replacing = !field.multiple && uploads.length > 0;
        const attachmentPath = `${path}/${encodeURIComponent(file.id)}`;
        const url =
          config.attachmentUrl?.(attachmentPath) ??
          `${(config.apiBaseUrl ?? '/api').replace(/\/$/, '')}${attachmentPath}`;
        return (
          <Box
            key={file.id}
            sx={{ ...cardStyle, opacity: removal || replacing ? 0.65 : 1 }}
          >
            <FilePreview name={file.name} mimeType={file.mimeType} url={url} />
            <Box sx={{ flex: 1, minWidth: 120 }}>
              <Typography
                variant="body2"
                sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}
              >
                {file.name}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {fileSize(file.size)}
              </Typography>
              {(removal || replacing) && (
                <Chip
                  size="small"
                  variant="outlined"
                  label={removal ? 'Pending removal' : 'Will be replaced'}
                  sx={{ display: 'flex', width: 'fit-content', mt: 0.5 }}
                />
              )}
            </Box>
            <Box sx={{ display: 'flex', gap: 0.5 }}>
              <Button size="small" component="a" href={url}>
                Download
              </Button>
              {canWrite && (
                <Button
                  size="small"
                  type="button"
                  color={removal ? 'primary' : 'error'}
                  disabled={disabled || replacing}
                  onClick={() =>
                    onChange(
                      removal
                        ? changes.filter((change) => change !== removal)
                        : [
                            ...changes,
                            { kind: 'remove', field: field.field, id: file.id },
                          ],
                    )
                  }
                >
                  {removal ? 'Undo' : 'Remove'}
                </Button>
              )}
            </Box>
          </Box>
        );
      })}
      {uploads.map(
        (change, index) =>
          change.kind === 'upload' && (
            <Box key={index} sx={cardStyle}>
              <FilePreview name={change.file.name} file={change.file} />
              <Box sx={{ flex: 1, minWidth: 120 }}>
                <Typography
                  variant="body2"
                  sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}
                >
                  {change.file.name}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {fileSize(change.file.size)}
                </Typography>
                <Chip
                  size="small"
                  color="primary"
                  variant="outlined"
                  label="Pending upload"
                  sx={{ display: 'flex', width: 'fit-content', mt: 0.5 }}
                />
              </Box>
              {canWrite && (
                <Button
                  type="button"
                  size="small"
                  disabled={disabled}
                  onClick={() =>
                    onChange(changes.filter((entry) => entry !== change))
                  }
                >
                  Cancel
                </Button>
              )}
            </Box>
          ),
      )}
      {canWrite && (
        <Box
          onDragOver={(event) => {
            event.preventDefault();
            if (!disabled) setDragging(true);
          }}
          onDragLeave={(event) => {
            if (
              !event.currentTarget.contains(event.relatedTarget as Node | null)
            )
              setDragging(false);
          }}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            stage(Array.from(event.dataTransfer.files));
          }}
          sx={{
            border: '1.5px dashed',
            borderColor: dragging ? 'primary.main' : 'divider',
            borderRadius: 2,
            p: 3,
            textAlign: 'center',
            bgcolor: dragging ? 'action.selected' : 'background.default',
            opacity: disabled ? 0.5 : 1,
            transition: 'background-color 150ms, border-color 150ms',
          }}
        >
          <Box sx={{ color: 'primary.main', mb: 1 }}>
            <svg
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 16V3m-5 5 5-5 5 5M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" />
            </svg>
          </Box>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            Drag and drop {field.multiple ? 'files' : 'a file'} here
          </Typography>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: 'block', mt: 0.5, mb: 1.5 }}
          >
            {formats || 'All file types'}
            {!field.multiple && ' · One file'}
          </Typography>
          <Button
            type="button"
            variant="outlined"
            size="small"
            disabled={disabled}
            onClick={() => input.current?.click()}
            aria-label={`Choose ${field.label.toLowerCase()}`}
          >
            {!field.multiple && (files.length > 0 || uploads.length > 0)
              ? 'Replace file'
              : field.multiple
                ? 'Choose files'
                : 'Choose file'}
          </Button>
          <input
            ref={input}
            type="file"
            hidden
            accept={field.accept}
            multiple={field.multiple}
            disabled={disabled}
            onChange={(event) => {
              stage(Array.from(event.target.files ?? []));
              event.target.value = '';
            }}
          />
        </Box>
      )}
      {error && <Alert severity="error">{error}</Alert>}
      <FormHelperText>
        {field.hint ?? 'Uploads and removals are applied when you save.'}
      </FormHelperText>
    </FormControl>
  );
}
