'use client';

import { useEffect, useState, type FormEvent } from 'react';
import {
  Alert,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  MenuItem,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import ResourceFields from './resource-fields';
import { flattenFields } from '../lib/form-layout';
import { passwordChanges } from '../lib/password-fields';
import { readFieldPath, nestFieldValues } from '../lib/field-paths';
import ResourceAttachments from './resource-attachments';
import { saveAttachments, type AttachmentChange } from '../lib/attachments';
import { useAdmin } from '../runtime';
import type {
  FormValues,
  Option,
  ResourceList,
  ResourceRecord,
  SectionConfig,
} from '../configs/types';

function editorValues(
  section: SectionConfig,
  record?: ResourceRecord | null,
): FormValues {
  return Object.fromEntries(
    flattenFields(section.formFields)
      .filter((field) => field.type !== 'attachment')
      .map((field) => {
        if (field.type === 'password') return [field.field, ''];
        const value =
          readFieldPath(record, field.field) ??
          readFieldPath(section.defaults, field.field) ??
          null;
        return [
          field.field,
          field.type === 'json'
            ? JSON.stringify(value, null, 2)
            : field.type === 'datetime-local' && typeof value === 'string'
              ? value.replace(/Z$/, '')
              : value,
        ];
      }),
  );
}

function message(error: unknown) {
  return error instanceof Error
    ? error.message
    : 'The request failed. Please try again.';
}

export default function ResourceSection({
  section,
  recordId,
  canWrite,
  onAccessChange,
}: {
  section: SectionConfig;
  recordId: string | null;
  canWrite: boolean;
  onAccessChange: () => Promise<void>;
}) {
  const { api } = useAdmin();
  const [result, setResult] = useState<ResourceList | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [editorLoading, setEditorLoading] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [query, setQuery] = useState('{}');
  const [attachmentChanges, setAttachmentChanges] = useState<
    AttachmentChange[]
  >([]);
  const [selected, setSelected] = useState<ResourceRecord | null>(null);
  const [values, setValues] = useState<FormValues>(() => editorValues(section));
  const [options, setOptions] = useState<Record<string, Option[]>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [lookupError, setLookupError] = useState('');
  const [notice, setNotice] = useState('');
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    const params = new URLSearchParams({
      page: String(page),
      limit: String(pageSize),
      sort: 'createdAt:desc',
      query,
    });
    api<ResourceList>(`/${section.key}?${params}`, {
      signal: controller.signal,
    })
      .then((list) => {
        if (controller.signal.aborted) return;
        if (page > Math.max(1, list.meta.totalPages))
          setPage(Math.max(1, list.meta.totalPages));
        else setResult(list);
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setError(message(error));
          setResult(null);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [api, section, page, pageSize, query, refresh]);

  useEffect(() => {
    const controller = new AbortController();
    setLookupError('');
    const sources = new Map(
      flattenFields(section.formFields).flatMap((field) =>
        field.itemsFrom
          ? [[field.itemsFrom.resource, field.itemsFrom] as const]
          : [],
      ),
    );
    async function load() {
      const loaded: Record<string, Option[]> = {};
      for (const source of sources.values()) {
        const items: Option[] = [];
        // Fetch every page; the CMS caps each request at 150 records.
        let current = 1;
        let totalPages = 1;
        do {
          const response = await api<ResourceList>(
            `/${source.resource}?page=${current}&limit=150&sort=createdAt:asc`,
            { signal: controller.signal },
          );
          items.push(
            ...response.data.map((record) => ({
              value: record.id,
              label: String(record[source.labelField]),
            })),
          );
          totalPages = response.meta.totalPages;
        } while (++current <= totalPages);
        loaded[source.resource] = items;
      }
      if (!controller.signal.aborted) setOptions(loaded);
    }
    void load().catch((error) => {
      if (!controller.signal.aborted) setLookupError(message(error));
    });
    return () => controller.abort();
  }, [api, section, refresh]);

  function select(record: ResourceRecord | null) {
    setSelected(record);
    setAttachmentChanges([]);
    setValues(editorValues(section, record));
    setError('');
    setNotice('');
  }

  useEffect(() => {
    const controller = new AbortController();
    setSelected(null);
    setAttachmentChanges([]);
    setError('');
    if (!recordId || recordId === 'new') {
      setValues(editorValues(section));
      setEditorLoading(false);
      return () => controller.abort();
    }
    setEditorLoading(true);
    api<ResourceRecord>(`/${section.key}/${encodeURIComponent(recordId)}`, {
      signal: controller.signal,
    })
      .then((record) => {
        if (!controller.signal.aborted) {
          setSelected(record);
          setValues(editorValues(section, record));
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(message(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setEditorLoading(false);
      });
    return () => controller.abort();
  }, [api, section, recordId]);

  function navigate(id?: string) {
    setNotice('');
    window.location.hash = `/${section.key}${id ? `/${encodeURIComponent(id)}` : ''}`;
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    let recordSaved = false;
    try {
      const passwords = passwordChanges(
        flattenFields(section.formFields),
        values,
      );
      const payload = nestFieldValues(
        flattenFields(section.formFields)
          .filter(
            (field) => field.type !== 'attachment' && field.type !== 'password',
          )
          .map((field) => {
            const raw = values[field.field];
            let value = typeof raw === 'string' ? raw.trim() : raw;
            if (field.serialize) {
              value = field.serialize(raw, values);
            } else if (field.type === 'json') {
              try {
                value = JSON.parse(String(raw));
              } catch {
                throw new Error(`${field.label} must contain valid JSON.`);
              }
            } else if (
              field.type === 'number' &&
              value !== null &&
              value !== ''
            ) {
              value = Number(value);
              if (!Number.isFinite(value))
                throw new Error(`${field.label} must be a number.`);
            } else if (field.type === 'datetime-local' && value) {
              value = new Date(`${value}Z`).toISOString();
            }
            return [field.field, value];
          }),
        { ...section.defaults, ...selected },
      );
      let record = await api<ResourceRecord>(
        `/${section.key}${selected ? `/${encodeURIComponent(selected.id)}` : ''}`,
        { method: selected ? 'PATCH' : 'POST', body: JSON.stringify(payload) },
      );
      const isNew = !selected;
      recordSaved = true;
      setSelected(record);
      record = await saveAttachments(
        api,
        section.key,
        record,
        attachmentChanges,
        (change, updated) => {
          setSelected(updated);
          setAttachmentChanges((pending) =>
            pending.filter((entry) => entry !== change),
          );
        },
      );
      for (const change of passwords) {
        await api(change.path(record.id), {
          method: 'PUT',
          body: JSON.stringify({ password: change.password }),
        });
        // Clear only successful password changes, so a later failure can be retried.
        setValues((current) => ({ ...current, [change.field]: '' }));
      }
      select(record);
      if (recordId === 'new')
        window.location.hash = `/${section.key}/${encodeURIComponent(record.id)}`;
      setNotice(isNew ? `${section.label} record created.` : 'Changes saved.');
      if (isNew) setPage(1);
      setRefresh((value) => value + 1);
      await onAccessChange();
    } catch (error) {
      setError(
        recordSaved
          ? `Record details were saved, but saving did not finish. ${message(error)} Remaining changes are still pending; click Save changes to retry.`
          : message(error),
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!selected) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api(`/${section.key}/${encodeURIComponent(selected.id)}`, {
        method: 'DELETE',
      });
      select(null);
      setDeleteOpen(false);
      window.location.hash = `/${section.key}`;
      setNotice('Record deleted.');
      setRefresh((value) => value + 1);
      await onAccessChange();
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }

  function search(event: FormEvent) {
    event.preventDefault();
    const conditions = Object.fromEntries(
      section.searchFields
        .filter((field) => filters[field.field])
        .map((field) => [
          field.field,
          field.type === 'text'
            ? { $contains: filters[field.field].trim() }
            : field.boolean
              ? filters[field.field] === 'true'
              : filters[field.field],
        ]),
    );
    setQuery(JSON.stringify(conditions));
    setPage(1);
  }

  const editing = recordId !== null;
  const recordTitle = selected
    ? String(
        selected.title ??
          selected.displayName ??
          selected.name ??
          section.singular,
      )
    : `New ${section.singular}`;
  const alerts = (
    <>
      {error && (
        <Alert severity="error" className="mb-5">
          {error}
        </Alert>
      )}
      {lookupError && (
        <Alert
          severity="error"
          className="mb-5"
          action={
            <Button onClick={() => setRefresh((value) => value + 1)}>
              Retry
            </Button>
          }
        >
          Could not load field options: {lookupError}
        </Alert>
      )}
      {notice && (
        <Alert severity="success" className="mb-5">
          {notice}
        </Alert>
      )}
    </>
  );

  if (editing)
    return (
      <>
        <Button onClick={() => navigate()} disabled={busy} className="mb-5">
          ← Back to {section.label.toLowerCase()}
        </Button>
        <div className="mb-7">
          <Typography variant="h4" component="h1">
            {recordId === 'new'
              ? `New ${section.singular}`
              : `${canWrite ? 'Edit' : 'View'} ${section.singular}`}
          </Typography>
          <Typography color="text.secondary" className="mt-2">
            {recordId === 'new' ? section.description : recordTitle}
          </Typography>
        </div>
        {(editorLoading || (recordId !== 'new' && !selected)) && alerts}
        {editorLoading ? (
          <CircularProgress aria-label="Loading record" />
        ) : recordId !== 'new' && !selected ? (
          <Alert severity="warning">
            The record could not be loaded. Return to the list and try again.
          </Alert>
        ) : (
          <div className="w-full space-y-6">
            <Paper variant="outlined" className="p-6 md:p-8">
              <Typography variant="h6" component="h2" className="mb-6">
                {section.label} details
              </Typography>
              <form onSubmit={save}>
                <ResourceFields
                  fields={section.formFields}
                  renderAttachment={(field) => (
                    <ResourceAttachments
                      key={field.field}
                      resource={section.key}
                      field={field}
                      record={selected}
                      canWrite={canWrite}
                      changes={attachmentChanges}
                      disabled={busy || !canWrite}
                      onChange={setAttachmentChanges}
                    />
                  )}
                  values={values}
                  options={options}
                  disabled={busy || !canWrite}
                  onChange={setValues}
                />
                <Divider className="my-7" />
                {alerts}
                <div className="flex flex-wrap gap-3">
                  {canWrite && (
                    <Button
                      type="submit"
                      variant="contained"
                      disabled={busy || !!lookupError}
                    >
                      {busy
                        ? 'Saving…'
                        : selected
                          ? 'Save changes'
                          : `Create ${section.singular}`}
                    </Button>
                  )}
                  <Button onClick={() => navigate()} disabled={busy}>
                    Back to list
                  </Button>
                  {selected && canWrite && (
                    <Button
                      color="error"
                      onClick={() => setDeleteOpen(true)}
                      disabled={busy}
                      className="ml-auto"
                    >
                      Delete
                    </Button>
                  )}
                </div>
              </form>
            </Paper>
          </div>
        )}
        <Dialog
          open={deleteOpen}
          onClose={() => {
            if (!busy) setDeleteOpen(false);
          }}
          aria-labelledby="delete-title"
        >
          <DialogTitle id="delete-title">
            Delete {section.singular}?
          </DialogTitle>
          <DialogContent>
            <DialogContentText>
              This permanently deletes “{recordTitle}”. This action cannot be
              undone.
            </DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button disabled={busy} onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button color="error" disabled={busy} onClick={remove}>
              Delete record
            </Button>
          </DialogActions>
        </Dialog>
      </>
    );

  return (
    <>
      <div className="mb-7 flex flex-wrap items-center justify-between gap-4">
        <div>
          <Typography variant="h4" component="h1">
            {section.label}
          </Typography>
          <Typography color="text.secondary" className="mt-2">
            {section.description}
          </Typography>
        </div>
        {canWrite && (
          <Button variant="contained" onClick={() => navigate('new')}>
            + New {section.singular}
          </Button>
        )}
      </div>
      {alerts}
      <Paper variant="outlined" className="overflow-hidden">
        <form
          onSubmit={search}
          className="flex flex-wrap items-center gap-4 p-5"
        >
          {section.searchFields.map((field) => (
            <TextField
              key={field.field}
              label={field.label}
              select={field.type === 'select'}
              value={filters[field.field] ?? ''}
              onChange={(event) =>
                setFilters({ ...filters, [field.field]: event.target.value })
              }
              className="w-full sm:w-52"
              slotProps={{ htmlInput: { maxLength: 254 } }}
            >
              {field.type === 'select'
                ? [
                    <MenuItem key="all" value="">
                      All
                    </MenuItem>,
                    ...(field.items ?? []).map((item) => (
                      <MenuItem key={item.value} value={item.value}>
                        {item.label}
                      </MenuItem>
                    )),
                  ]
                : null}
            </TextField>
          ))}
          <Button type="submit" variant="outlined">
            Search
          </Button>
          <Button
            onClick={() => {
              setFilters({});
              setQuery('{}');
              setPage(1);
            }}
          >
            Clear
          </Button>
          <Button
            disabled={loading}
            onClick={() => setRefresh((value) => value + 1)}
            className="sm:ml-auto"
          >
            Refresh
          </Button>
        </form>
        <Divider />
        <TableContainer>
          <Table aria-label={`${section.label} records`}>
            <TableHead>
              <TableRow>
                {section.listFields.map((field) => (
                  <TableCell key={field.field}>{field.label}</TableCell>
                ))}
                <TableCell align="right">Action</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell
                    colSpan={section.listFields.length + 1}
                    align="center"
                    className="h-48"
                  >
                    <CircularProgress size={28} aria-label="Loading records" />
                  </TableCell>
                </TableRow>
              ) : !result?.data.length ? (
                <TableRow>
                  <TableCell
                    colSpan={section.listFields.length + 1}
                    align="center"
                    className="h-48"
                  >
                    <Typography color="text.secondary">
                      {result
                        ? 'No records found.'
                        : 'Could not load records. Try Refresh.'}
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                result.data.map((record) => (
                  <TableRow
                    key={record.id}
                    hover
                    onClick={() => navigate(record.id)}
                    className="cursor-pointer"
                  >
                    {section.listFields.map((field) => {
                      const value = record[field.field];
                      const display =
                        value == null || value === ''
                          ? '—'
                          : field.itemsFrom
                            ? (options[field.itemsFrom.resource]?.find(
                                (item) => item.value === value,
                              )?.label ?? String(value))
                            : field.type === 'boolean'
                              ? value
                                ? 'Yes'
                                : 'No'
                              : field.type === 'date'
                                ? new Date(String(value)).toLocaleDateString()
                                : Array.isArray(value)
                                  ? value.join(', ') || 'None'
                                  : String(value);
                      return (
                        <TableCell
                          key={field.field}
                          className="max-w-80 break-words"
                        >
                          {field.field === 'status' ? (
                            <Chip
                              label={display}
                              size="small"
                              color={
                                value === 'published' ? 'success' : 'default'
                              }
                              variant="outlined"
                            />
                          ) : (
                            display
                          )}
                        </TableCell>
                      );
                    })}
                    <TableCell align="right">
                      <Button
                        component="a"
                        href={`#/${section.key}/${encodeURIComponent(record.id)}`}
                        onClick={(event) => event.stopPropagation()}
                        aria-label={`${canWrite ? 'Edit' : 'View'} ${String(record.title ?? record.displayName ?? record.name ?? section.singular)}`}
                      >
                        {canWrite ? 'Edit' : 'View'}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination
          component="div"
          count={result?.meta.total ?? 0}
          page={page - 1}
          rowsPerPage={pageSize}
          rowsPerPageOptions={[10, 20, 50]}
          onPageChange={(_, next) => setPage(next + 1)}
          onRowsPerPageChange={(event) => {
            setPageSize(Number(event.target.value));
            setPage(1);
          }}
          disabled={loading}
        />
      </Paper>
    </>
  );
}
