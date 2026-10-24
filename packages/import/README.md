# @nestjs-cms/import

Google Sheets imports for `@nestjs-cms/core` resources, with an optional authenticated
NestJS endpoint integrated with `@nestjs-cms/auth`.

## Configuration

```dotenv
GSHEET_KEY_PATH=./key.json
GSHEET_ID=your-spreadsheet-id
# Optional: omit/leave blank for every registered resource that has a matching tab.
GSHEET_IMPORT_RESOURCES=categories,pages
```

Keep credentials on the server and out of Git. Share the spreadsheet with the service
account. The importer requests only the Google Sheets read-only OAuth scope.
`importOptionsFromEnv(process.env, projectRoot)` resolves relative key paths against
an explicit root; its default root is the current working directory.

```ts
const authModule = CmsAuthModule.forRoot(authConfig);
@Module({
  imports: [authModule, CmsImportModule.forRoot({
    imports: [authModule],
    ...importOptionsFromEnv(process.env, projectRoot),
  })],
})
export class AppModule {}
```

The module provides `POST /api/database/import`. It requires a valid session,
`X-CMS-Request: 1`, a matching browser Origin when supplied, `users:manage`, and write
permission for every matching selected resource. The body cannot change the sheet,
credentials, resource limit, or permission checks. Keep your normal admin origin/proxy
configuration. Import creates no new authentication mechanism.

## CLI

The package provides a `nestjs-cms-import` executable:

```json
"database:import": "nestjs-cms-import --config ./src/auth.config.ts --base-dir ../.."
```

The configuration file must export `authConfig` (a `CmsAuthOptions` object) and load
any environment files it needs. TypeScript configurations require `ts-node` and
`typescript` installed in the application; compiled JavaScript configurations also
work (`--config ./dist/auth.config.js`). Paths are resolved from the working
directory. `--base-dir` controls relative Google credential paths and defaults to
the working directory. For an npm workspace script, use paths relative to that
workspace.

Run `npm run database:import -- --dry-run` to preview or `npm run database:import`
to import. The CLI disables schema synchronization, does not bootstrap an admin,
and closes the database connection after importing. Use `--help` for usage.

For programmatic use, invoke
`new DatabaseImporter(dataSource, registry, options).run()`.
`run({ dryRun: true })` validates rows and references and predicts create/update counts
without invoking hooks or writing. It does not predict every SQL constraint or hook
failure. Disable data-source synchronization if the CLI should only import data.

## Spreadsheet format

Use tabs named exactly after resources, such as `categories`, `pages`, `roles`, `users`.
Other tabs are ignored. Row 1 contains headers. Every nonempty row needs `_key`, unique
within its tab, using letters, digits, dots, underscores or hyphens (maximum 120 chars).
Treat keys as permanent identities, not row numbers. No `id` column is needed.

| categories | |
| --- | --- |
| _key | name |
| news | News |

| pages | | |
| --- | --- | --- |
| _key | title | categoryId@categories |
| welcome | Welcome | news |

`field@resource` must match a declared single-column foreign key to the target's `id`.
Put the target `_key` in the cell. Records are ordered automatically. References to
excluded tabs work only if those keys have already been imported into this database.
Missing references and circular references fail the import.

- Field headers must match persisted schema fields. Dotted headers such as
  `translations.en`, `translations.tc`, and `translations.sc` address declared
  nested object fields in JSON columns. Do not mix a parent header and its dotted
  descendants. Blank dotted cells preserve stored siblings; new rows use defaults.
- Numbers and booleans are converted based on column types. Use `true` / `false`.
- JSON fields use JSON text: `["news"]`, `{"en":"Welcome","tc":"歡迎","sc":"欢迎"}`.
- Use ISO dates (`2026-10-01`) and timestamps (`2026-10-01T09:00:00Z`) as text.
- Blank cells omit a field: new rows use schema defaults; updates keep stored values.
- The literal `null` clears a nullable field. To set an empty string where needed,
  use a resource-specific editing workflow; blank sheet cells mean omission.
- Passwords are not imported. Use the auth password endpoint. Attachment URL columns
  are supported as described below. User/role extension fields work like other persisted fields.
- Explicit resource limits are validated; resources without matching tabs are reported
  as `skippedSheets`. Empty tabs contain no imported records.

## Data behavior

The spreadsheet ID, resource name and `_key` deterministically produce a UUIDv5. The
same import updates the same rows instead of duplicating them. Changing a key or
spreadsheet ID means a new identity. Existing independently-created records are not
matched by email/name: uniqueness conflicts fail rather than silently overwrite them.
Import never deletes database rows when a sheet row is removed.

All selected rows use one serializable transaction. Validate the complete batch before
writing, preserve resource before/after hooks, and roll back on errors. Hook-managed
external side effects cannot be rolled back; use a transactional outbox for those.
PostgreSQL advisory locks and MySQL connection locks reject concurrent imports; a
second in-process request also receives 409. This implementation targets the core
package's PostgreSQL/MySQL databases. The default maximum is 10,000 imported rows.

Results contain `total`, per-resource `created`/`updated` counts, `dryRun`, and
`skippedSheets`. An unchanged row is still counted as updated. Imports are synchronous;
configure the reverse-proxy request timeout for the expected dataset size.

## Admin menu

With an admin package supporting the import action:

```ts
defineAdmin({
  // ...
  databaseImport: { label: 'Import database' },
});
```

This shows an action below section navigation for `users:manage`, sends a POST through
the configured API client, prevents repeated clicks, reports completion/errors, and
refreshes the active section. `path` and `permission` can customize UI behavior; the
server's permission rules remain authoritative.

String arrays (including string enums) also accept comma-separated cells: `help, news`
becomes `["help", "news"]`. Items are trimmed and empty items discarded. JSON arrays
remain supported, including `[]` to clear a field or `["a,b"]` for a string containing
a comma. Non-string arrays and object-valued cells still require JSON. Conversion
does not bypass schema validation: string-enum arrays still enforce their allowed
values. The demo tags use a free-form nonempty string schema.

## Import attachment URLs

Use the attachment field name as the column header, such as `cover` or `documents`.
The importer reads the resource's `attachments` definition to determine whether the
field accepts one URL or comma-separated URLs (`multiple: true`). Single attachment
fields reject multiple URLs. No header suffix is needed.

| _key | title | cover | documents |
| --- | --- | --- | --- |
| welcome | Welcome | https://example.com/cover.jpg | https://example.com/guide.pdf, https://example.com/terms.pdf |

Cells contain plain direct HTTP(S) file URLs, not hyperlink labels or HTML preview
pages. Percent-encode any literal comma in a URL as `%2C`. Blank cells preserve
attachments. `null` is not supported for attachment cells; remove files through the
attachment API. Repeated URLs are deduplicated. A changed single URL replaces the
previous attachment; multiple URLs append files. Removing a URL from the sheet does
not delete an existing attachment. Reimporting an unchanged URL reuses its imported
attachment, even if the remote file contents have changed; use a new URL to refresh it.

Downloads enforce each field's allowed MIME types and the smaller of its size limit
and the global attachment limit. Files must be publicly accessible; private/local
network addresses, credential-bearing URLs and redirects to private addresses are
rejected. Downloads have a 30-second timeout and at most five redirects. Google
Drive preview/share pages must be replaced with publicly downloadable file URLs.

`--dry-run` downloads and checks the files but does not upload them or write rows.
A real import stages files in configured object storage, then commits ready metadata
in the same database transaction as the records. Failed imports leave pending files
for the regular storage cleanup job; existing records and ready attachments remain
unchanged. Object storage must be configured just as it is for API uploads. This
feature requires core and import packages built with attachment import support.
