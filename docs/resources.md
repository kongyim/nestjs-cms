# Resource definitions

## Add a resource

1. Create a file in your application's `src/resources/` folder (or the directory configured with `resourcesPath`).
2. Define a Zod schema and default-export `defineResource(...)` with that schema.
3. Restart the development server. No index file or manual registration is needed.

At startup, `ResourceModule.forRoot({ resourcesPath })` scans the first level of the configured directory in filename order. A standard NestJS application compiles `src/resources/*.ts` to `dist/resources/*.js`, which are loaded in both `start:dev` and production. For a ts-node application, set `extension: ".ts"` explicitly. The library never scans its own demo resources when installed as a dependency. Prefix helper files with `_`, such as `_hooks.ts` or `_schema.ts`. Hidden files, declaration files, `.spec` / `.test` files, and subdirectories are ignored. Invalid exports or duplicate resource names stop startup and identify the failing file.

Discovery runs at startup, not on each request. Restart after adding or removing files. Production requires a new build/deployment and any necessary database migrations. Keep the host build configured to clear its output directory (the standard Nest CLI uses `deleteOutDir: true`) so removed resources cannot be loaded from stale JavaScript files. With `DB_SYNCHRONIZE=true` in development, adding one resource file creates its table and registers its API.

No additional controller or service is required. Define database columns explicitly: Zod controls the input contract, while TypeORM controls SQL storage and database constraints. Database constraints are not inferred from Zod refinements.

```ts
import { defineResource, z } from "@nestjs-cms/core";

export const schema = z
  .object({
    title: z.string().trim().min(1).max(200),
    status: z.enum(["draft", "published"]).default("draft"),
  })
  .strict();

export default defineResource({
  name: "pages",
  label: "Pages",
  schema,
  columns: {
    title: { type: String, length: 200 },
    status: { type: String, length: 20 },
  },
  filterable: ["title", "status"],
  sortable: ["title", "createdAt"],
  attachments: [
    {
      field: "cover",
      mimeTypes: ["image/png", "image/jpeg"],
      maxBytes: 5 * 1024 * 1024,
    },
  ],
  hooks: {
    onBeforeCreate: [
      ({ record }) => ({ ...record, title: String(record.title).trim() }),
    ],
  },
});
```

Resource names start with a lowercase letter and may contain lowercase letters, digits, and underscores. They also name the database table. The framework adds a UUID string `id`, `createdAt`, and `updatedAt`. These fields and `attachments` are reserved: do not redefine them in the schema/columns or send them in write requests.

Normal payload fields should correspond to columns. Use `type: "json"` for nested objects and arrays. For compatibility with both databases, choose shared column types rather than database-specific types such as PostgreSQL `jsonb` or native arrays. UUIDs are stored as `varchar(36)`.

Single attachment fields use `{ field, mimeTypes }`; add `multiple: true` for collections. Do not put attachment fields in the Zod schema or database columns: their metadata is stored separately. Responses expose each attachment field directly on the record (for example, `record.cover` and `record.files`) as an object/null or an array. Attachment field names cannot collide with system fields, schema fields, or database columns. Resource write payloads do not accept attachment metadata, object keys, or bucket names.

Use `foreignKeys` for relationships between resources; see `resources/articles.ts`. Relations are not automatically expanded. The article hook checks `categoryId` before writing, and the database foreign key enforces referential integrity under concurrency. Categories referenced by articles cannot be deleted.

## Validation and updates

Create requests run through Zod, including defaults, then before hooks. The hook result is validated against the full schema before writing. Unknown input fields return 400.

Both PUT and PATCH perform **partial updates**: omitted fields retain their values; null is accepted only for nullable fields. Nested JSON fields are replaced as a whole, not deep-merged. The default patch schema is `schema.partial()`. Only keys actually sent by the client are applied, preventing defaults from resetting omitted fields. The merged record is then validated against the full schema.

Schemas with object-level refinements may not support `.partial()`. Supply an explicit `updateSchema`, such as a partial object without defaults, in that case. The merged record still passes through the complete schema. For resource discovery, use Zod types that can be converted to JSON Schema; move complex transformations into hooks where appropriate. Client-side JSON Schema does not replace server-side refinements.

## Hooks

| Hook           | Timing                      | `record`                                    |
| -------------- | --------------------------- | ------------------------------------------- |
| onBeforeCreate | Before insert               | Validated input and defaults                |
| onAfterCreate  | After insert, before commit | Persisted record                            |
| onBeforeUpdate | Before update               | Existing values plus patch, fully validated |
| onAfterUpdate  | After update, before commit | Persisted record                            |
| onBeforeDelete | Before delete               | Persisted record                            |
| onAfterDelete  | After delete, before commit | Record as it existed before deletion        |

Each hook receives `{ manager, resource, action, id, record, previous }`. Update/delete hooks also receive `previous`. Hooks run in array order. Before hooks can mutate `record` or return a **complete replacement record**. Before-create/update results must conform to the schema. Return values from after hooks are not written back; use the supplied manager for additional database writes.

```ts
import type { ResourceHook } from "@nestjs-cms/core";

const hook: ResourceHook = async ({ manager, record, id }) => {
  await manager.getRepository("audit_logs").insert({
    resourceId: id,
    title: record.title,
  });
};
```

This example requires you to define the `audit_logs` table. All hook database operations must use the context manager. Global repositories do not participate in the same transaction. If any hook throws, the CRUD operation and writes through that manager roll back.

Update/delete operations lock the parent record. Attachment mutations use the same parent lock. After hooks run **after the write but before commit**, not after commit. Use a transactional outbox for email, webhooks, and other external effects that cannot be rolled back.

Attachment upload/download/remove operations do not trigger CRUD hooks or update the parent's `updatedAt`. SQL metadata and S3 writes are not a distributed atomic transaction. Pending/deleted rows are retained for cleanup retries when needed.

## Comparison with the original project

| Original configuration or behavior     | This package                                                      |
| -------------------------------------- | ----------------------------------------------------------------- |
| Default config and named schema export | `defineResource({ schema, columns, ... })`                        |
| Prisma `delegate`                      | TypeORM resource table/entity for PostgreSQL and MySQL            |
| `prisma` hook context                  | Transactional `manager`                                           |
| Six lifecycle hooks                    | Same names and order; after hooks run before commit               |
| Filesystem attachment storage          | Multipart API uploads and streamed downloads backed by S3         |
| `fields[].attachment/attachments`      | `attachments: [{ field, multiple, mimeTypes }]`                   |
| Flat `nameEn/nameTc/nameSc` mappings   | JSON `name: { en, tc, sc }`                                       |
| Arbitrary ORM queries and `limit=all`  | Allowlisted filters and at most 150 items per page                |
| Numeric/custom IDs                     | UUID string IDs                                                   |
| Rights and `publicList`                | Not implemented; an optional shared API key applies to all routes |
| Product/order-specific core logic      | Business rules belong in resource hooks                           |

Existing configurations require adaptation; this is an independent resource framework. Migration of existing business data is outside the current scope.

## Service attachment API

Controllers and business services manage attachments through `ResourceService`:

```ts
await resources.createAttachment(resource, recordId, field, {
  originalname: "photo.png",
  mimetype: "image/png",
  buffer,
});
const metadata = await resources.findAttachment(
  resource,
  recordId,
  field,
  attachmentId,
);
const { attachment, stream } = await resources.downloadAttachment(
  resource,
  recordId,
  field,
  attachmentId,
);
await resources.removeAttachment(resource, recordId, field, attachmentId);
```

`createAttachment` and `findAttachment` return `{ id, name, mimeType, size, createdAt }`. Finding an attachment reads only database metadata; it does not access S3. `downloadAttachment` returns that metadata and a Node readable stream. The controller sets HTTP headers and sends the response. `removeAttachment` returns `{ id, deleted: true }`.

Find/download operations accept only ready attachments and validate the resource, parent record, field, and attachment ownership. Missing/deleted attachments return 404; invalid attachment fields return 400.

Dependencies flow from `ResourceController` to `ResourceService`, then `AttachmentService`, then `S3Service`. The resource and attachment services share `ResourceRecordStore` for parent lookup and transactional locking, avoiding circular dependencies. The storage cleanup CLI uses `AttachmentService` directly, outside the controller request flow.

## Module configuration

Import `ResourceModule.forRoot(...)` once in the host application. `resourcesPath` is required and should be an absolute path such as `join(__dirname, "resources")` in `src/app.module.ts`. The default file extension is `.js`; use `.ts` only when a TypeScript runtime such as ts-node is installed and active.

The module builds its own data source from `.env`. Advanced applications can supply a dedicated `dataSource` created with `createCmsDataSource(...)`, for example to register migrations. The CMS module initializes that source if necessary and closes it when the module shuts down; do not share it with an unrelated connection owner.

Importing `defineResource` or the package entry point does not discover files or connect to a database. Resource discovery occurs when `forRoot` is called, and connection initialization occurs during Nest startup. Environment configuration is read when the package is imported, so set process variables or create `.env` before startup.
