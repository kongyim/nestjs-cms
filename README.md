# nestjs-cms

Add a resource-driven CMS backend to a NestJS application. Define each resource in one file; the module discovers it and provides validated CRUD APIs, filters, lifecycle hooks, and S3-backed attachments.

## Quick start

Requires Node.js 22+, npm, and a PostgreSQL database. The package supports NestJS 11 with the Express adapter.

### 1. Create a NestJS project and install the package

```sh
npx @nestjs/cli@11 new nestjs-cms-demo --package-manager npm
cd nestjs-cms-demo
npm install nestjs-cms
```

The npm package includes compiled JavaScript and TypeScript declarations. Imports use `"nestjs-cms"`.

The package includes Zod, TypeORM, PostgreSQL/MySQL drivers, dotenv, and the S3 client. The NestJS project supplies the NestJS runtime dependencies.

### 2. Create a resource

```sh
mkdir -p src/resources
```

Create `src/resources/pages.ts`:

```ts
import { defineResource, z } from "nestjs-cms";

export default defineResource({
  name: "pages",
  schema: z
    .object({
      title: z.string().trim().min(1).max(200),
      status: z.enum(["draft", "published"]).default("draft"),
    })
    .strict(),
  columns: {
    title: { type: String, length: 200 },
    status: { type: String, length: 20 },
  },
  filterable: ["title", "status"],
  sortable: ["title", "createdAt"],
});
```

Keep the folder inside `src` so the standard Nest compiler builds it into `dist/resources`. Each additional resource requires only one new file in this folder. No resource index or per-resource registration is needed.

### 3. Import the CMS module once

Add `ResourceModule.forRoot(...)` to the `imports` array in `src/app.module.ts`:

```ts
import { Module } from "@nestjs/common";
import { join } from "node:path";
import { ResourceModule } from "nestjs-cms";

@Module({
  imports: [
    ResourceModule.forRoot({ resourcesPath: join(__dirname, "resources") }),
  ],
})
export class AppModule {}
```

You can keep your existing controllers, providers, and other imports. The module's API-key guard and error filter apply only to CMS routes.

### 4. Configure `.env`

Create `.env` in the new project's root:

```dotenv
NODE_ENV=development
PORT=3000
DB_TYPE=postgres
DB_HOST=127.0.0.1
DB_PORT=5432
DB_USERNAME=cms
DB_PASSWORD=cms_dev_password
DB_DATABASE=cms
DB_SYNCHRONIZE=true
ADMIN_API_KEY=
CORS_ORIGINS=
```

Use credentials for an existing PostgreSQL database. The package loads `.env` automatically. With `DB_SYNCHRONIZE=true`, it creates the resource tables in that database during startup. Use migrations instead in production.

If you need a local database and port 5432 is available:

```sh
docker run --name nestjs-cms-demo-postgres -d \
  -e POSTGRES_USER=cms -e POSTGRES_PASSWORD=cms_dev_password -e POSTGRES_DB=cms \
  -p 127.0.0.1:5432:5432 postgres:17-alpine
```

Wait for PostgreSQL to be ready before starting the application. The example above supports plain resource CRUD. **Attachments also require working S3/MinIO storage and an attachment field in the resource definition.**

### 4a. Configure storage for attachments

For local MinIO, add these settings to your application's `.env`:

```dotenv
S3_REGION=us-east-1
S3_BUCKET=cms-attachments
S3_ENDPOINT=http://127.0.0.1:9000
S3_FORCE_PATH_STYLE=true
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=minioadmin123
ATTACHMENT_MAX_BYTES=20971520
```

These credentials match this library's development Compose setup. From the `nestjs-cms` repository checkout, start storage with:

```sh
docker compose up -d --build minio minio-init
```

Wait for MinIO to become healthy and `minio-init` to finish successfully; it creates the private `cms-attachments` bucket. The npm package does not start storage or include the Compose setup. You can also use an existing MinIO server: supply its endpoint and credentials and create the bucket beforehand. The endpoint above assumes the application runs on your host machine.

For AWS S3 instead, use your bucket's region and name, omit `S3_ENDPOINT`, and set `S3_FORCE_PATH_STYLE=false`. Supply both credential variables, or omit both when using an IAM role. See [AWS S3 configuration](docs/operations.md#aws-s3-configuration) for permissions.

In `src/resources/pages.ts`, add this property to the existing `defineResource({...})` object:

```ts
attachments: [
  { field: "cover", mimeTypes: ["image/jpeg", "image/png", "image/webp"] },
],
```

Attachment fields are declared separately from the Zod schema and database columns. After restarting the application and creating a page, upload a file using its record ID:

```sh
curl -X POST http://localhost:3000/api/pages/RECORD_ID/attachments/cover \
  -F 'file=@/absolute/path/to/cover.png'
```

Replace `RECORD_ID` and the file path with your values. If `ADMIN_API_KEY` is configured, include the `X-API-Key` header. Uploads and downloads always pass through the backend attachment API; the browser never connects directly to S3/MinIO.

Without working object storage, the application can start and plain resource CRUD still works. Storage is contacted when an attachment operation needs it: uploads fail with HTTP 503 (`Object storage upload unavailable`), and downloads of existing attachments fail with HTTP 503 (`Attachment content unavailable`). There is no local-filesystem fallback. Omitting the S3 settings does not disable attachments; the client uses the default region/bucket and AWS credential chain, which only works if that environment already has access to the matching storage.

### 5. Start the application

```sh
npm run start:dev
```

```sh
curl http://localhost:3000/api/_resources
curl -X POST http://localhost:3000/api/pages \
  -H 'Content-Type: application/json' \
  -d '{"title":"About us"}'
curl http://localhost:3000/api/pages
```

After adding or removing resource files, rebuild/restart the application. The standard Nest CLI TypeScript build emits the resource files separately; bundlers require additional configuration to preserve those files for runtime discovery.

For production, run the host project's `npm run build` and `npm run start:prod`, disable schema synchronization, and apply reviewed migrations. The library does not run or install its demo migrations in your application.

### Optional: CORS and shutdown hooks

Same-origin frontends do not require CORS. To apply `CORS_ORIGINS` for a separate frontend and enable graceful shutdown, call the helper in your application's existing `src/main.ts`:

```ts
import { configureCmsApp } from "nestjs-cms";

// After NestFactory.create(AppModule), before app.listen(...):
configureCmsApp(app);
```

Set `CORS_ORIGINS=http://localhost:5173`, for example. Your host application still controls its listening port, bind address, and bootstrap process. If it already manages CORS and shutdown hooks, keep that configuration instead.

## Install a local package

From this library's checkout:

```sh
npm ci
npm pack
```

This builds `nestjs-cms-0.1.0.tgz`, including JavaScript and TypeScript declarations. In the new NestJS project, replace the npm installation step with:

```sh
npm install /absolute/path/to/nestjs-cms-0.1.0.tgz
```

The package excludes the demo application, demo resources, demo migrations, tests, and local secrets. Packing does not publish anything to a registry.

## Install from GitHub (optional)

To use an unpublished revision, install from GitHub instead of npm. This requires
Git and a GitHub SSH key with access to the repository:

```sh
npm install git+ssh://git@github.com/kongyim/nestjs-cms.git
```

The package's `prepare` script builds TypeScript during Git installation. Keep
npm lifecycle scripts enabled. Append `#<tag-or-commit>` to the Git URL to select
an existing revision. Imports still use `"nestjs-cms"`.

### Troubleshooting: Cannot find module `nestjs-cms`

Run `npm ls nestjs-cms` in the consuming application and check that
`node_modules/nestjs-cms/dist/src/index.js` and `index.d.ts` exist. To reinstall
the published package, stop the development server and run:

```sh
npm uninstall nestjs-cms
npm install nestjs-cms
npm run start:dev
```

For Git installations, missing compiled files can indicate an older revision or
a failed `prepare` script. Reinstall with `--foreground-scripts` to see build
output, or use a locally packed package as described above.

## Publishing updates to npm

Run the following commands in the package you changed: the repository root for
`nestjs-cms`, or `packages/admin` for `@nestjs-cms/admin`. The packages have
independent versions; release only the packages you changed.

```sh
npm ci
npm run release:check
npm run version:patch
npm run release
```

- `release:check` runs tests, builds the package, and previews the files to publish
  without uploading anything. Review that file list before continuing. For backend
  changes involving the database or storage, also run `npm run test:integration`
  with the required services running.
- `version:patch` updates `package.json` and `package-lock.json` automatically
  (for example, `0.1.0` → `0.1.1`). No manual version editing is needed.
  Use `version:minor` for a feature release (`0.1.0` → `0.2.0`) or
  `version:major` for a major release (`0.1.0` → `1.0.0`). During `0.x`
  development, document breaking changes explicitly and use a minor release;
  from `1.0.0` onward, use a major release for breaking changes.
- `release` publishes the current version publicly. Tests run again through
  `prepublishOnly`, and the existing packaging hook builds the package before
  upload. If needed, run `npm login --auth-type=web` first and complete npm's
  authentication prompts.

Every published update needs a new version, including README-only updates on npm.
A published name/version cannot be reused. These scripts do not create Git commits
or tags: review and commit the code, README, and version/lockfile changes, then
push them to GitHub to keep the release source recorded.

If publication fails after the version bump, fix the problem and run
`npm run release` again without bumping again, provided that version was not
published. If the outcome is unclear, check `npm view <package-name>@<version> version`
first. The version scripts only change local files; `release:check` does not bump
versions, and `release` does not bump automatically.

See [npm version](https://docs.npmjs.com/cli/commands/npm-version/) for version
updates and [npm publish](https://docs.npmjs.com/cli/commands/npm-publish/) for
publication rules.

## Documentation

- [Resource definitions, hooks, and service methods](docs/resources.md)
- [API contract and frontend examples](docs/api.md)
- [Environment, databases, storage, and deployment](docs/operations.md)

`ResourceService` is exported for use in other application services. It provides CRUD and `createAttachment`, `findAttachment`, `downloadAttachment`, and `removeAttachment`. All browser attachment traffic goes through the backend API.

User login, roles, and resource rights are not implemented. Setting `ADMIN_API_KEY` requires `X-API-Key` on CMS requests; production currently requires a key of at least 32 characters. This is an integration mechanism, not a full authentication system.

## Develop this library

The repository also contains a demo application with `categories` and `articles`. These instructions are for library contributors, not package consumers:

```sh
npm ci
cp .env.example .env
docker compose up -d --build
# Wait for postgres/minio to be healthy and minio-init to exit with code 0.
npm run seed
npm run dev
```

The first MinIO build compiles a pinned source release and takes longer than subsequent starts. The demo API runs at `http://localhost:3000/api`, and the MinIO console at `http://localhost:9001`.

```sh
npm run format
npm run format:check
npm run build
npm test
npm run test:integration
# Optional MySQL verification:
docker compose --profile mysql up -d mysql
DB_TYPE=mysql DB_PORT=3307 npm run test:integration
```

Integration tests use the dedicated `cms_test` database and real MinIO services. The repository's VS Code settings enable formatting on save when the recommended Prettier extension is installed. These editor settings are not installed into consuming applications.

## Scope

The package implements resource discovery, CRUD, filters, transactional hooks, and backend-managed attachments. Import/export, image resizing, encrypted/hashed fields, automatic relation expansion, and resource permissions are not included. Multilingual and nested fields use JSON. See the [comparison with the original project](docs/resources.md#comparison-with-the-original-project) for differences from `polyu-souvenirs`.

## Reusable admin frontend

The companion React package lives in [packages/admin](packages/admin/README.md).
It provides the portal UI, explicitly configured sections in navigation order,
nested JSON fields, deferred attachments, and inline password actions. It is
packaged independently as `@nestjs-cms/admin`; the core backend package does not
install frontend dependencies. See the package README for build/install steps,
Next.js setup, and authentication/transport adapters.
