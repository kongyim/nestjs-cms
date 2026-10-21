# Development, storage, and deployment

The quick start in the README is for applications that install `nestjs-cms`. Commands involving this repository's `docker-compose.yml`, seed script, or demo migration are for library contributors. A consuming application owns its database, migrations, startup scripts, and storage provisioning.

## Environment

Runtime settings are loaded from `.env` and validated with Zod. Process environment variables take precedence. Do not commit `.env` to version control.

| Setting                                 | Meaning                                                                                                  |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| NODE_ENV                                | development / test / production                                                                          |
| HOST / PORT                             | Used by the repository demo; a consuming Nest application controls its own listen options                |
| CORS_ORIGINS                            | Comma-separated frontend origins                                                                         |
| ADMIN_API_KEY                           | Optional shared key; production requires at least 32 characters until user authentication is implemented |
| DB_TYPE                                 | postgres / mysql                                                                                         |
| DB_HOST / DB_PORT                       | Database endpoint; an omitted port uses the driver's default                                             |
| DB_USERNAME / DB_PASSWORD / DB_DATABASE | Database credentials and name                                                                            |
| DB_SYNCHRONIZE                          | Development only; enabling it in production prevents startup                                             |
| S3_REGION / S3_BUCKET                   | Region and existing private bucket                                                                       |
| S3_ENDPOINT                             | MinIO or S3-compatible endpoint; omit for AWS S3                                                         |
| S3_FORCE_PATH_STYLE                     | Use true for MinIO; typically false for AWS S3                                                           |
| S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY | Provide both, or omit both to use the AWS credential chain/IAM role                                      |
| ATTACHMENT_MAX_BYTES                    | Defaults to 20 MiB, with a configuration maximum of 1 GiB; field maxBytes can lower the limit            |

When the API runs on the host, `.env.example` uses `http://127.0.0.1:9000`. In the Compose network, use `S3_ENDPOINT=http://minio:9000`. Only the backend needs access to that endpoint. The browser never connects directly to S3/MinIO. `S3_PUBLIC_ENDPOINT` and `S3_URL_TTL_SECONDS` have been removed.

For a same-origin frontend, use `CORS_ORIGINS=`. If the variable is omitted entirely, the code defaults to `http://localhost:5173`. For a separate frontend origin, list that origin explicitly and call `configureCmsApp(app)` during the host application bootstrap, or configure CORS yourself. Since storage traffic passes through the backend, **S3 bucket/MinIO browser CORS is not required**.

## Local services

```sh
docker compose up -d --build
docker compose ps -a
```

Wait for PostgreSQL and MinIO to become healthy and for `minio-init` to exit with code 0. The initializer creates a private bucket and a lifecycle rule for legacy staging objects.

The MinIO image is built from a pinned official source release because the public images used during initial setup could no longer be pulled. The first build downloads and compiles Go dependencies. The source-build approach follows the [official release instructions](https://github.com/minio/minio/releases/tag/RELEASE.2025-10-15T17-29-55Z). This Compose setup is for local development, not a production storage deployment.

## PostgreSQL and MySQL

PostgreSQL 17 is the default, exposed on host port 5432. MySQL 8.4 is an optional Compose profile, exposed on host port **3307** to avoid conflicts with another MySQL server on 3306.

```sh
docker compose --profile mysql up -d mysql
# Alternatively, change these values in .env.
DB_TYPE=mysql DB_PORT=3307 DB_SYNCHRONIZE=true npm run seed
DB_TYPE=mysql DB_PORT=3307 npm run dev
```

Both services initialize separate `cms` and `cms_test` databases. Switching drivers does not transfer data. Resource definitions use compatible JSON storage, UUID varchar columns, SQL types, parameterized queries, and row locks. Search case sensitivity depends on database collation and may differ between drivers.

## Migrations

### Installed applications

The package does not include the demo migrations. Use `DB_SYNCHRONIZE=true` only for initial development. For production, create a data source in your application and generate/review migrations for your own resources:

```ts
// src/cms-data-source.ts
import { join } from "node:path";
import { createCmsDataSource, loadResources } from "nestjs-cms";

export const cmsDataSource = createCmsDataSource(
  loadResources(join(__dirname, "resources"), ".js"),
  { migrations: [join(__dirname, "migrations/*.js")] },
);
```

Build the host application, then run the TypeORM CLI against the compiled file with synchronization disabled. The package supplies TypeORM as a dependency; declare it directly in your host dependencies if you depend on its CLI as part of your own tooling.

```sh
npm install typeorm@^0.3.25
npm run build
DB_SYNCHRONIZE=false npx typeorm migration:generate src/migrations/InitialCms -d dist/cms-data-source.js
# Review the generated migration, rebuild, then apply it.
npm run build
DB_SYNCHRONIZE=false npx typeorm migration:run -d dist/cms-data-source.js
```

For runtime use, pass `dataSource: cmsDataSource` to `ResourceModule.forRoot` alongside the same `resourcesPath`. Generating a migration requires a database representing the previous schema, not one already synchronized to the new schema. Adapt output paths if your host compiler uses a different layout.

### Repository demo

The portable initial migration creates categories, articles, attachment metadata, and the article/category foreign key. For a **new, empty database**:

```sh
DB_SYNCHRONIZE=false npm run db:migrate
```

Do not apply the initial migration directly to a development database whose tables were already created by synchronization. Use a fresh database or establish a reviewed migration baseline. Do not reset a database containing data you need to preserve.

After changing a resource, generate a migration against a development database that represents the previously deployed schema:

```sh
DB_SYNCHRONIZE=false npm run db:generate -- src/database/migrations/AddPages
# Review the SQL, especially uniqueness, nullability, and data conversions.
DB_SYNCHRONIZE=false npm run db:migrate
```

Generate the migration before synchronization applies the new schema, otherwise there may be no difference left to generate. TypeORM-generated migrations are usually driver-specific. To support both PostgreSQL and MySQL, use the QueryRunner Table/ForeignKey APIs or explicit driver branches and verify both databases. The initial migration follows this approach. MySQL DDL can implicitly commit; do not assume schema changes can be rolled back transactionally.

Production builds include resources and migrations:

```sh
npm ci
npm run build
# Supply production environment/secrets and set DB_SYNCHRONIZE=false.
node node_modules/typeorm/cli.js migration:run -d dist/src/database/data-source.js
npm start
```

## Attachment lifecycle

All traffic follows `Browser → Attachment API → S3 / MinIO`. The browser sends a multipart `file` POST and receives metadata when it succeeds. There is no initiate/complete exchange. Download GET streams bytes through the API without a storage URL or redirect. Delete detaches metadata immediately; cleanup removes the stored object.

1. Nest's FileInterceptor receives one file in memory, subject to the global limit, which defaults to 20 MiB. It does not write to the local filesystem.
2. The service validates the field, MIME type, actual size, field limit, and parent record, then persists pending metadata.
3. The backend uploads the object to a private S3 key with a five-minute timeout. Failure returns 503, retaining the pending row for cleanup.
4. On success, a transaction locks the parent and attachment row and changes pending to ready. For single fields, the previous attachment becomes deleted; multiple fields append.
5. GET validates ownership and ready status, then streams S3 content. Downloads do not buffer the entire file in backend memory.

Uploads currently buffer the complete file, bounded by `ATTACHMENT_MAX_BYTES`. Allow enough RAM for concurrent uploads and configure reverse-proxy body limits and timeouts accordingly. Downloads stream; a storage/network failure after streaming begins terminates the response, and clients should retry. HTTP Range and resumable uploads are not implemented.

SQL and S3 are not a distributed transaction. If S3 succeeds but the database commit fails, pending metadata remains for cleanup. If the parent is deleted during upload, finalization fails and cleanup removes the object. A single attachment is replaced only when its successor becomes ready, so failed uploads do not discard the existing attachment.

The existing attachment table is retained without a migration. New rows have an empty `stagingKey`; `expiresAt` records pending creation time for cleanup. Existing ready attachments keep their keys and remain readable through the API. Previously issued presigned URLs expire normally; new ones are not issued.

## Cleanup

In an installed application, inject the exported `AttachmentService` into a scheduled job and call `cleanup()`. Check its `failures` array and retry failed rows. The library does not install a scheduler or copy the repository's CLI scripts into the host application.

For the repository demo:

```sh
npm run storage:cleanup
# For a compiled deployment:
node dist/scripts/cleanup.js
```

Run cleanup through a scheduler or cron, for example every 15 minutes. This repository does not install a schedule automatically. Cleanup processes rows whose `expiresAt` is at least one hour old, protecting active uploads. Pending/deleted objects are removed before their metadata rows. Failed rows remain for retry, and the CLI exits with code 1 if any operation fails. For ready attachments, only legacy staging objects are removed, never the final object.

MinIO initialization retains a one-day expiration rule for `staging/` to handle objects left by the former direct-upload flow. New uploads do not use staging. Do not apply blanket expiration to `attachments/`. Versioned buckets need a separate noncurrent-version expiration policy because DeleteObject creates a delete marker.

The current cleanup CLI scans eligible metadata, including ready rows. Larger deployments can replace this with a cursor-based batch worker. It does not scan arbitrary bucket objects that have no metadata record; do not manually remove metadata rows.

## AWS S3 configuration

```dotenv
S3_REGION=ap-east-1
S3_BUCKET=your-private-cms-bucket
S3_FORCE_PATH_STYLE=false
# Omit S3_ENDPOINT to use the AWS endpoint.
# Also omit S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY when using an IAM role.
```

Create the bucket beforehand and keep Block Public Access enabled. The backend principal needs `s3:PutObject`, `s3:GetObject`, and `s3:DeleteObject` on `attachments/*`, plus DeleteObject on `staging/*` when cleaning legacy objects. SSE-KMS requires corresponding KMS permissions. Development root credentials and plain HTTP are for local use only.

MIME validation uses the multipart Content-Type. Magic-byte detection, virus scanning, and image resizing are not implemented; add them before marking metadata ready if needed.

## References

- [NestJS file upload and streaming](https://docs.nestjs.com/techniques/file-upload)
- [TypeORM EntitySchema](https://typeorm.io/docs/entity/separating-entity-definition/)
- [TypeORM transactions](https://orkhan.gitbook.io/typeorm/docs/transactions)
- [MinIO pinned release and source-build instructions](https://github.com/minio/minio/releases/tag/RELEASE.2025-10-15T17-29-55Z)
