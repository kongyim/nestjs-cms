# nestjs-cms

Add a resource-driven CMS backend to a NestJS application. Define each resource in one file; the module discovers it and provides validated CRUD APIs, filters, lifecycle hooks, and S3-backed attachments.

## Quick start

Requires Node.js 22+, npm, and a PostgreSQL database. The package supports NestJS 11 with the Express adapter.

### 1. Create a NestJS project and install the package

```sh
npx @nestjs/cli@11 new my-cms --package-manager npm
cd my-cms
npm install nestjs-cms
```

**Publication status:** this version has not been published to npm yet. The install-by-name command above is the intended workflow after publication; it should not be used to fetch an unrelated package. Until then, [install a locally packed release](#install-a-local-package) with `npm install /path/to/nestjs-cms-0.1.0.tgz` instead. No source folders need to be copied.

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
docker run --name my-cms-postgres -d \
  -e POSTGRES_USER=cms -e POSTGRES_PASSWORD=cms_dev_password -e POSTGRES_DB=cms \
  -p 127.0.0.1:5432:5432 postgres:17-alpine
```

Wait for PostgreSQL to be ready before starting the application. S3/MinIO is needed only when using attachments; plain resource CRUD works without object storage. See [storage configuration](docs/operations.md#aws-s3-configuration) for attachment settings.

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

This builds `nestjs-cms-0.1.0.tgz`, including JavaScript and TypeScript declarations. In the new NestJS project, replace the install-by-name step with:

```sh
npm install /absolute/path/to/nestjs-cms-0.1.0.tgz
```

The package excludes the demo application, demo resources, demo migrations, tests, and local secrets. Packing does not publish anything to a registry.

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
