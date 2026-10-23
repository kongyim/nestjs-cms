# @nestjs-cms/core

Add a resource-driven CMS backend to a NestJS application. Define each resource in one file; the module discovers it and provides validated CRUD APIs, filters, lifecycle hooks, and S3-backed attachments.

For a complete API and admin workspace with login, start with
[Build a CMS from scratch](#build-a-cms-from-scratch), or
[use the demo as a template](#build-your-own-cms-repository). For a backend-only
integration into a new NestJS application, follow the quick start below.

## Quick start

Requires Node.js 22+, npm, and a PostgreSQL database. The package supports NestJS 11 with the Express adapter.

### 1. Create a NestJS project and install the package

```sh
npx @nestjs/cli@11 new nestjs-cms-demo --package-manager npm
cd nestjs-cms-demo
npm install @nestjs-cms/core
```

The npm package includes compiled JavaScript and TypeScript declarations. Imports use `"@nestjs-cms/core"`.

The package includes Zod, TypeORM, PostgreSQL/MySQL drivers, dotenv, and the S3 client. The NestJS project supplies the NestJS runtime dependencies.

### 2. Create a resource

```sh
mkdir -p src/resources
```

Create `src/resources/pages.ts`:

```ts
import { defineResource, z } from "@nestjs-cms/core";

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
import { ResourceModule } from "@nestjs-cms/core";

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
import { configureCmsApp } from "@nestjs-cms/core";

// After NestFactory.create(AppModule), before app.listen(...):
configureCmsApp(app);
```

Set `CORS_ORIGINS=http://localhost:5173`, for example. Your host application still controls its listening port, bind address, and bootstrap process. If it already manages CORS and shutdown hooks, keep that configuration instead.

## Build a CMS from scratch

Use this route to create your own repository without cloning or renaming the
demo. You will build a NestJS API, a Next.js admin at `/admin`, PostgreSQL, and
MinIO, including administrator login, user and role management, and image uploads.
Docker runs the database and storage; Node.js runs the two applications.

`@nestjs-cms/auth` supplies users, roles, database-backed sessions, and the
login API. You configure the module once; no copied authentication files are
needed. This walkthrough uses the latest npm releases of all three CMS packages.

### 1. Create the repository and two apps

Install Node.js 22+, npm, Git, and Docker with Docker Compose. Choose your project
folder name in the first command; subsequent commands use workspace paths, so
there are no demo-specific package names to rename:

```sh
mkdir my-cms
cd my-cms
git init
mkdir apps
npx @nestjs/cli@11 new api --directory apps/api --package-manager npm --skip-git --skip-install
npx create-next-app@16 apps/admin --ts --app --src-dir --eslint --no-tailwind --use-npm --import-alias "@/*" --skip-install --disable-git
```

For any additional Next.js prompts, keep the defaults. These commands use NestJS
11 and Next.js 16; the CMS packages are installed from their latest npm releases
in the next step. See the [Nest CLI options](https://docs.nestjs.com/cli/usages)
and [Next.js CLI options](https://nextjs.org/docs/app/api-reference/cli/create-next-app)
for the scaffold commands.

Create `package.json` in the repository root:

```json
{
  "name": "my-cms",
  "private": true,
  "workspaces": ["apps/*"],
  "scripts": {
    "dev:api": "npm run start:dev --workspace=apps/api",
    "dev:admin": "npm run dev --workspace=apps/admin -- --hostname 127.0.0.1 --port 3001",
    "build": "npm run build --workspaces",
    "typecheck:admin": "tsc --noEmit -p apps/admin/tsconfig.json",
    "start:api": "npm run start:prod --workspace=apps/api",
    "start:admin": "npm run start --workspace=apps/admin -- --hostname 127.0.0.1 --port 3001"
  }
}
```

You can change `name` to your own project name. Create a root `.gitignore`:

```gitignore
node_modules/
dist/
.next/
coverage/
*.tsbuildinfo
.env
.env.*
!.env.example
```

Run all remaining shell commands from this repository root unless stated otherwise:

```sh
npm install
npm install @nestjs-cms/core@latest @nestjs-cms/auth@latest dotenv --workspace=apps/api
npm install @nestjs-cms/admin@latest @mui/material-nextjs@9 @emotion/cache --workspace=apps/admin
mkdir -p docker apps/api/src/resources apps/admin/src/sections
```

Keep the single root `package-lock.json` in Git. The resulting layout will be:

```text
my-cms/
  apps/api/src/             NestJS host, authentication, and resources
  apps/admin/src/           Next.js shell and admin configuration
  docker/                  MinIO Dockerfile and bucket initializer
  docker-compose.yml       PostgreSQL and MinIO; no pgAdmin
  .env                     Local settings, excluded from Git
  package.json
  package-lock.json
```

### 2. Create the shared environment file

Create `.env` in the repository root. Replace the example passwords with your
own values; the administrator password must have 12–128 characters:

```dotenv
NODE_ENV=development
PORT=3000
DB_TYPE=postgres
DB_HOST=127.0.0.1
DB_PORT=5432
DB_USERNAME=cms
DB_PASSWORD=change-this-local-db-password
DB_DATABASE=cms
DB_SYNCHRONIZE=true

S3_REGION=us-east-1
S3_BUCKET=cms-attachments
S3_ENDPOINT=http://127.0.0.1:9000
S3_FORCE_PATH_STYLE=true
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=change-this-local-storage-password
ATTACHMENT_MAX_BYTES=20971520

ADMIN_ORIGIN=http://localhost:3001
ADMIN_BOOTSTRAP_EMAIL=admin@example.com
ADMIN_BOOTSTRAP_PASSWORD=choose-a-unique-admin-password
ADMIN_API_KEY=
CORS_ORIGINS=
```

Bootstrap creates the first administrator only when the users table is empty.
Remove both bootstrap values after the first successful startup; existing
accounts and passwords are never overwritten. `ADMIN_API_KEY` may be empty for
local development because session authentication still protects the API. No
secret is passed to the frontend.

### 3. Create Docker Compose and the storage files

Create `docker-compose.yml` in the repository root:

```yaml
services:
  postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: ${DB_USERNAME:?Set DB_USERNAME in .env}
      POSTGRES_PASSWORD: ${DB_PASSWORD:?Set DB_PASSWORD in .env}
      POSTGRES_DB: ${DB_DATABASE:?Set DB_DATABASE in .env}
    ports:
      - "127.0.0.1:${DB_PORT:-5432}:5432"
    volumes:
      - postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", 'pg_isready -U "$$POSTGRES_USER" -d "$$POSTGRES_DB"']
      interval: 5s
      timeout: 3s
      retries: 30

  minio:
    build:
      context: ./docker
      dockerfile: minio.Dockerfile
    command: server /data --console-address ':9001'
    environment:
      MINIO_ROOT_USER: ${S3_ACCESS_KEY_ID:?Set S3_ACCESS_KEY_ID in .env}
      MINIO_ROOT_PASSWORD: ${S3_SECRET_ACCESS_KEY:?Set S3_SECRET_ACCESS_KEY in .env}
    ports:
      - "127.0.0.1:9000:9000"
      - "127.0.0.1:9001:9001"
    volumes:
      - minio-data:/data
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:9000/minio/health/live"]
      interval: 5s
      timeout: 3s
      retries: 30

  minio-init:
    build:
      context: ./docker
      dockerfile: storage-init.Dockerfile
    depends_on:
      minio:
        condition: service_healthy
    environment:
      S3_ENDPOINT: http://minio:9000
      S3_REGION: ${S3_REGION:-us-east-1}
      S3_BUCKET: ${S3_BUCKET:?Set S3_BUCKET in .env}
      S3_ACCESS_KEY_ID: ${S3_ACCESS_KEY_ID:?Set S3_ACCESS_KEY_ID in .env}
      S3_SECRET_ACCESS_KEY: ${S3_SECRET_ACCESS_KEY:?Set S3_SECRET_ACCESS_KEY in .env}

volumes:
  postgres-data:
  minio-data:
```

Create `docker/minio.Dockerfile`. This builds a pinned MinIO source release:

```dockerfile
FROM golang:1.24.8-bookworm AS build
ENV CGO_ENABLED=0
RUN go install github.com/minio/minio@RELEASE.2025-10-15T17-29-55Z

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && rm -rf /var/lib/apt/lists/*
COPY --from=build /go/bin/minio /usr/local/bin/minio
EXPOSE 9000 9001
ENTRYPOINT ["minio"]
```

Create `docker/storage-init.Dockerfile`:

```dockerfile
FROM node:22-alpine
WORKDIR /app
RUN npm init -y && npm install --save-exact @aws-sdk/client-s3@3.850.0
COPY init-s3.cjs ./init-s3.cjs
CMD ["node", "init-s3.cjs"]
```

Create `docker/init-s3.cjs`:

```js
const { S3Client, CreateBucketCommand } = require("@aws-sdk/client-s3");

const client = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  },
});

async function main() {
  const Bucket = process.env.S3_BUCKET;
  try {
    await client.send(new CreateBucketCommand({ Bucket }));
  } catch (error) {
    if (error.name !== "BucketAlreadyOwnedByYou") throw error;
  }
  console.log(`Private bucket ready: ${Bucket}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => client.destroy());
```

Start the services:

```sh
docker compose up -d --build
docker compose ps -a
docker compose logs minio-init
```

The first MinIO build can take several minutes. Continue when PostgreSQL and
MinIO are healthy and `minio-init` has exited with code 0. The bucket is private;
uploads and downloads will go through your authenticated API.

There is no pgAdmin service. You can inspect the database using
`docker compose exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'`.
The MinIO console is at `http://localhost:9001`; sign in with your S3 credentials.

### 4. Configure the NestJS host and a resource

Create `apps/api/src/env.ts` so the API loads the root `.env` even though npm runs
its workspace commands from `apps/api`:

```ts
import { config } from "dotenv";
import { resolve } from "node:path";

config({ path: resolve(__dirname, "../../../.env") });
```

Replace `apps/api/tsconfig.json` with the following. This explicitly uses CommonJS
and keeps compiled resources at `dist/resources`, where discovery expects them:

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "moduleResolution": "node",
    "target": "ES2023",
    "rootDir": "./src",
    "outDir": "./dist",
    "declaration": true,
    "sourceMap": true,
    "removeComments": true,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "incremental": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "test", "**/*.spec.ts"]
}
```

Create `apps/api/src/resources/pages.ts`:

```ts
import { defineResource, z } from "@nestjs-cms/core";

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
  attachments: [
    { field: "cover", mimeTypes: ["image/jpeg", "image/png", "image/webp"] },
  ],
});
```

### 5. Enable authentication, users, and roles

Replace `apps/api/src/app.module.ts`:

```ts
import "./env";
import { Module } from "@nestjs/common";
import { join } from "node:path";
import { CmsAuthModule } from "@nestjs-cms/auth";

@Module({
  imports: [
    CmsAuthModule.forRoot({
      resourcesPath: join(__dirname, "resources"),
      adminOrigin: process.env.ADMIN_ORIGIN ?? "http://localhost:3001",
      bootstrapAdmin: process.env.ADMIN_BOOTSTRAP_EMAIL
        ? {
            email: process.env.ADMIN_BOOTSTRAP_EMAIL,
            password: process.env.ADMIN_BOOTSTRAP_PASSWORD ?? "",
          }
        : undefined,
    }),
  ],
})
export class AppModule {}
```

This registers the CMS and authentication together. Do not also import
`ResourceModule.forRoot`, create your own `users`/`roles` definitions, or copy
an auth guard. The default admin prefix is `/admin`. The package automatically
registers `pages:read`, `pages:write`, and the built-in `users:manage` permission.

Replace `apps/api/src/main.ts`:

```ts
import "./env";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT ?? 3000), "127.0.0.1");
}
void bootstrap();
```

Do not add a global `/api` prefix: CMS routes and the auth controller already
include it. The generated `app.controller.ts` and `app.service.ts` are unused
and can be deleted along with their generated test. Only the registered auth
controller and CMS routes are needed here.

### 6. Configure the admin and its API proxy

Replace `apps/admin/next.config.ts`:

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  basePath: "/admin",
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "http://127.0.0.1:3000/api/:path*",
      },
    ];
  },
};

export default nextConfig;
```

Next.js adds `/admin` to the rewrite source, so the browser calls
`/admin/api/pages` and the API receives `/api/pages`. This also keeps the login
cookie on the admin origin. The frontend does not need to read the root `.env`.

Create `apps/admin/src/sections/pages.ts`:

```ts
import { defineSection } from "@nestjs-cms/admin";

export default defineSection({
  key: "pages",
  label: "Pages",
  singular: "page",
  description: "Manage page content and cover images.",
  readPermission: "pages:read",
  writePermission: "pages:write",
  defaults: { title: "", status: "draft" },
  listFields: [
    { field: "title", label: "Title" },
    { field: "status", label: "Status" },
    { field: "cover", label: "Cover", type: "attachment" },
  ],
  searchFields: [{ field: "title", label: "Title", type: "text" }],
  formFields: [
    {
      field: "title",
      label: "Title",
      type: "text",
      required: true,
      maxLength: 200,
    },
    {
      field: "status",
      label: "Status",
      type: "select",
      items: [
        { value: "draft", label: "Draft" },
        { value: "published", label: "Published" },
      ],
    },
    {
      field: "cover",
      label: "Cover",
      type: "attachment",
      accept: "image/jpeg,image/png,image/webp",
    },
  ],
});
```

Create `apps/admin/src/admin.config.ts`:

```ts
"use client";

import { defineAdmin, createAuthSections } from "@nestjs-cms/admin";
import pages from "./sections/pages";

export default defineAdmin({
  title: "My CMS",
  apiBaseUrl: "/admin/api",
  defaultSection: "pages",
  sections: [
    pages,
    ...createAuthSections([
      { value: "pages:read", label: "View pages" },
      { value: "pages:write", label: "Edit pages" },
    ]),
  ],
});
```

Replace `apps/admin/src/app/page.tsx`:

```tsx
"use client";

import { AdminPortal } from "@nestjs-cms/admin";
import config from "../admin.config";

export default function Page() {
  return <AdminPortal config={config} />;
}
```

Replace `apps/admin/src/app/layout.tsx`:

```tsx
import type { ReactNode } from "react";
import { AppRouterCacheProvider } from "@mui/material-nextjs/v16-appRouter";
import "@nestjs-cms/admin/styles.css";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AppRouterCacheProvider options={{ enableCssLayer: true }}>
          {children}
        </AppRouterCacheProvider>
      </body>
    </html>
  );
}
```

The package supplies its theme and CSS. The generated Next.js starter stylesheet
and font imports are not needed. No Tailwind configuration is required.

### 7. Start, sign in, and create a page

With Docker services healthy, run these commands in two terminals from the root:

```sh
# Terminal 1
npm run dev:api
```

```sh
# Terminal 2
npm run dev:admin
```

Open **http://localhost:3001/admin**. Sign in with `ADMIN_BOOTSTRAP_EMAIL` and
`ADMIN_BOOTSTRAP_PASSWORD` from `.env`. Create a page, enter a title, choose a status, select
a cover image, and save. Reopen it to check that its content and image were saved.
Create an Editor role with both page permissions in **Roles**, then create a
user with that role and a password in **Users**. Sign in as that user to check
restricted access. Remove both bootstrap variables after the first successful
startup. Sessions and accounts persist across API restarts.

Use the `localhost` browser address shown above: `ADMIN_ORIGIN` must match it
exactly. The API is at `http://127.0.0.1:3000/api`, but direct unauthenticated
requests return 401. Browser requests, including images, go through
`http://localhost:3001/admin/api/*`, where the session cookie is available.

If login fails, check the credentials and API logs; after ten login attempts in
one minute, wait a minute before retrying. If uploads return 503, check
`docker compose logs minio-init` and the S3 values in `.env`. If the database port
is occupied, change `DB_PORT` and recreate the Compose services. If you change
`PORT`, update the Next.js rewrite destination too.

### 8. Build and extend the starter

Check and build both apps:

```sh
npm run typecheck:admin
npm run build
```

To smoke-test the compiled API locally, stop `dev:api` and run `npm run start:api`
with `NODE_ENV=development`; keep `dev:admin` running. Use `start:admin` for the
built frontend. A production deployment must use HTTPS and the settings below.

Add more backend files in `apps/api/src/resources` and corresponding frontend
sections in `apps/admin/src/sections`; import each section into `admin.config.ts`
and add it to `sections` in navigation order. Restart the API after adding a
resource. See [resource definitions](docs/resources.md) and
[admin configuration](packages/admin/README.md) for categories, grouped forms,
nested fields, and custom dashboards. New resources default to `<resource>:read` and `<resource>:write` permissions.
Add those permission choices to `createAuthSections`, and grant them to the
appropriate roles. Existing roles are never silently granted new permissions.

For deployment, set `NODE_ENV=production`, use HTTPS and a public HTTPS
`ADMIN_ORIGIN`, set `DB_SYNCHRONIZE=false`, and apply reviewed migrations for
all resource and authentication tables. The core currently also requires a
server-only `ADMIN_API_KEY` of at least 32 characters. Update the Next.js proxy
if the API runs on another host. See the
[auth package guide](packages/auth/README.md) for migrations, sessions, permission
mappings, and deployment details, and [operations](docs/operations.md) for storage.

Stop infrastructure with `docker compose down`. Volumes preserve the database and
attachments; `docker compose down -v` deletes both. Changing credentials in `.env`
does not change the credentials already initialized in a PostgreSQL volume.

## Build your own CMS repository

This walkthrough uses `kongyim/nestjs-cms-demo` as a starting template for your own
repository. It gives you a NestJS API, a Next.js admin with a dashboard, pages,
categories, users and roles, plus PostgreSQL and MinIO for local development.
All package installation commands use the latest releases from npm.

The two packages have different responsibilities: `@nestjs-cms/core` supplies
resource APIs and attachments; `@nestjs-cms/admin` supplies the React portal.
`@nestjs-cms/auth` supplies login, sessions, account bootstrap, built-in users and
roles, and server-side permissions through one module registration.

### 1. Create your workspace from the demo

Install Node.js 22+, npm, Git, and Docker with Docker Compose. Start Docker, then
run these commands in the directory where you keep your projects:

```sh
git clone https://github.com/kongyim/nestjs-cms-demo.git my-cms
cd my-cms
git remote rename origin upstream
npm install
```

This keeps the demo's history and names its remote `upstream`. To push to your
own repository later, create an empty Git repository with your hosting provider,
then run `git remote add origin <your-repository-url>`.

The workspace already includes the app configuration and root npm scripts:

```text
my-cms/
  apps/
    api/
      src/resources/     Backend schemas for pages and categories
      src/app.module.ts  CMS and authentication registration
      src/env.ts         Loads the shared root .env
    admin/
      app/               Next.js App Router shell
      src/admin.config.ts
      src/sections/      Resource forms and dashboard registration
      src/components/    Custom dashboard component
      next.config.ts     Admin base path and same-origin API proxy
  docker/                MinIO build and private-bucket initialization
  docker-compose.yml
  package.json           npm workspaces and commands for both apps
  .env                   Create this in step 3; do not commit it
```

The folder name `my-cms` does not change the npm workspace names. The commands
below use the template's existing `@nestjs-cms-demo/api` and
`@nestjs-cms-demo/admin` names.

### 2. Install the latest CMS packages

From `my-cms`, update both workspaces:

```sh
npm install @nestjs-cms/core@latest @nestjs-cms/auth@latest --workspace=@nestjs-cms-demo/api
npm install @nestjs-cms/admin@latest --workspace=@nestjs-cms-demo/admin
```

If your copy of the template still uses the previous backend name `nestjs-cms`,
replace all imports from `'nestjs-cms'` with `'@nestjs-cms/core'` in
`apps/api/src` and `apps/api/test`, including type imports, then remove it:

```sh
npm uninstall nestjs-cms --workspace=@nestjs-cms-demo/api
```

For an older demo checkout with copied auth files, follow the migration steps in
[the auth package guide](packages/auth/README.md#migrating-the-demo). No local tarballs or library checkout are needed. Commit
the updated package files and root lockfile with your application.

### 3. Configure the database, storage, and first administrator

Create `.env` in `my-cms` (beside `docker-compose.yml`), using this complete local
development configuration. Replace the example passwords before starting:

```dotenv
NODE_ENV=development
PORT=3000

DB_TYPE=postgres
DB_HOST=127.0.0.1
DB_PORT=5432
DB_USERNAME=cms
DB_PASSWORD=change-this-local-db-password
DB_DATABASE=cms
DB_SYNCHRONIZE=true

S3_REGION=us-east-1
S3_BUCKET=cms-attachments
S3_ENDPOINT=http://127.0.0.1:9000
S3_FORCE_PATH_STYLE=true
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=change-this-local-storage-password
ATTACHMENT_MAX_BYTES=20971520

PGADMIN_DEFAULT_EMAIL=admin@example.com
PGADMIN_DEFAULT_PASSWORD=change-this-local-pgadmin-password

ADMIN_BASE_PATH=/admin
ADMIN_ORIGIN=http://localhost:3001
ADMIN_BOOTSTRAP_EMAIL=admin@example.com
ADMIN_BOOTSTRAP_PASSWORD=choose-a-unique-admin-password
ADMIN_API_KEY=
CORS_ORIGINS=
```

Use a 12–128 character administrator password. `ADMIN_API_KEY` can be empty for
this local setup: the demo still requires a valid user session and checks
permissions. Never expose a shared API key in frontend configuration.

The API and Next.js configuration load this root `.env`; Docker Compose reads
it too. `ADMIN_ORIGIN` is the browser origin without `/admin`. Keep browser URLs
on `localhost` consistently so origin checks and session cookies work together.

### 4. Start PostgreSQL and MinIO

From the workspace root:

```sh
docker compose up -d --build
docker compose ps -a
docker compose logs minio-init
```

The first build compiles MinIO and can take several minutes. Wait until
PostgreSQL and MinIO are healthy and `minio-init` exits with code 0. The initializer
creates the private bucket configured by `S3_BUCKET`.

The API runs on your host and connects to `127.0.0.1:5432` and
`http://127.0.0.1:9000`. If port 5432 is occupied, choose another `DB_PORT` in
`.env`; Compose and the API both use it. The other default ports are 3000, 3001,
8080, 9000, and 9001; stop conflicting services before continuing.

### 5. Start both apps and sign in

Run each command in a separate terminal, both from `my-cms`:

```sh
# Terminal 1
npm run dev:api
```

```sh
# Terminal 2
npm run dev:admin
```

Open **http://localhost:3001/admin** and sign in with your
`ADMIN_BOOTSTRAP_EMAIL` and `ADMIN_BOOTSTRAP_PASSWORD`. The first API startup
creates the tables and, only when the users table is empty, creates the
Administrator role and account. After a successful login, remove both bootstrap
variables from `.env` and restart the API. Changing those variables later does
not reset an existing account's password.

Try the complete workflow:

1. Create a category in **Categories**.
2. Create a page in **Pages**, select the category, and save it.
3. Edit the page, add an attachment, save, and reopen it to check persistence.
4. Create an Editor role with `pages:read` and `pages:write`, then create a user
   with that role and a password. Sign in as that user to check restricted access.

| Service       | Local URL                     | Login                                                 |
| ------------- | ----------------------------- | ----------------------------------------------------- |
| Admin portal  | `http://localhost:3001/admin` | CMS user email and password                           |
| NestJS API    | `http://localhost:3000/api`   | Session-protected; use the admin proxy in the browser |
| MinIO console | `http://localhost:9001`       | `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY`           |
| pgAdmin       | `http://localhost:8080`       | `PGADMIN_DEFAULT_EMAIL` / `PGADMIN_DEFAULT_PASSWORD`  |

In pgAdmin, open the preconfigured **CMS PostgreSQL** connection and enter
`DB_PASSWORD`. Its internal database host is `postgres`, not `localhost`.

Browser requests to `/admin/api/*` are proxied by Next.js to the NestJS `/api/*`
routes. The demo's default session cookie uses `/admin/api`, so test authenticated
browser requests through the admin URL. No separate browser CORS setup is needed.

### 6. Customize your CMS

Start with these files:

| Change                                           | File or directory                                     |
| ------------------------------------------------ | ----------------------------------------------------- |
| Portal title, initial screen, navigation order   | `apps/admin/src/admin.config.ts`                      |
| Dashboard content                                | `apps/admin/src/components/dashboard.tsx`             |
| Backend fields, validation, filters, attachments | `apps/api/src/resources/`                             |
| List columns, search controls, form fields       | `apps/admin/src/sections/`                            |
| Server-side resource permissions                 | `resourcePermissions` in `apps/api/src/app.module.ts` |
| Admin URL prefix and API destination             | `apps/admin/next.config.ts`                           |

For example, change the `title` in `admin.config.ts` and reorder its `sections`
array to rearrange navigation. `defaultSection` selects the first screen without
changing that order. Use `defineCustomSection` for a custom React page such as the
dashboard; use `defineSection` for a resource list and editor.

To add a resource, create its backend definition in `apps/api/src/resources`
using [the resource guide](docs/resources.md), then create a matching frontend
section whose `key` is the resource name. Import the section in `admin.config.ts`
and add it to `sections`. Backend resources are discovered automatically on
restart; frontend sections are registered explicitly. Match form fields to the
backend schema, and update the module permission mapping and role permissions for the new
resource. Hiding navigation alone does not restrict API access.

The [admin package guide](packages/admin/README.md) covers grouped forms,
responsive field widths, nested JSON, attachment previews, password actions,
and custom pages.

To move the portal, set `ADMIN_BASE_PATH=/cms` (or `/tools/cms`) in `.env` and
restart both apps. Sign in again at the new path. Set `ADMIN_BASE_PATH=` for `/`.
Production builds must be rebuilt after a base-path change because Next.js embeds
the path in browser assets.

### 7. Check and build your repository

From the workspace root:

```sh
npm test -- --runInBand
npm run typecheck:admin
npm run build
```

The build compiles both apps. To run the built applications, stop the development
servers and use separate terminals:

```sh
# Terminal 1
npm run start:api
```

```sh
# Terminal 2
npm run start:admin
```

For deployment, use HTTPS, `NODE_ENV=production`, `DB_SYNCHRONIZE=false`, reviewed
database migrations, a server-only `ADMIN_API_KEY` of at least 32 characters, and
the public admin origin in `ADMIN_ORIGIN`. Migrations must include the host's
resource, credential, and session tables. If the API runs on another host, update
the rewrite destination in `apps/admin/next.config.ts` before building. See
[operations](docs/operations.md) for database and storage configuration.

To stop local infrastructure, run `docker compose down`; the volumes retain your
data. Adding `-v` deletes database and storage data. Changing database credentials
in `.env` does not update a PostgreSQL user already stored in a volume.

### Troubleshooting the workspace

| Symptom                                     | Check                                                                                                       |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| API cannot connect to PostgreSQL            | Check `docker compose ps`, `DB_PORT`, and root `.env` credentials.                                          |
| Login fails on a fresh setup                | Check API startup logs, bootstrap password length, and whether the users table already contains an account. |
| Login works but requests fail or return 403 | Use `http://localhost:3001/admin`, check `ADMIN_ORIGIN`, and verify the user's role permissions.            |
| Attachments return 503                      | Check MinIO health, `minio-init` logs, and the API's S3 endpoint, credentials, and bucket.                  |
| A new resource or section is missing        | Restart the API for resource discovery; import the frontend section and add it to `sections`.               |

## Migrating from `nestjs-cms`

The backend package is now named `@nestjs-cms/core`. Existing applications can
switch with:

```sh
npm uninstall nestjs-cms
npm install @nestjs-cms/core
```

Replace imports from `"nestjs-cms"` with `"@nestjs-cms/core"`, including type
imports. The API is unchanged by this rename. The admin package remains
`@nestjs-cms/admin`; the GitHub repository remains `kongyim/nestjs-cms`.

## Install a local package

From this library's checkout:

```sh
npm ci
npm pack
```

This builds `nestjs-cms-core-0.1.3.tgz`, including JavaScript and TypeScript declarations. In the new NestJS project, replace the npm installation step with:

```sh
npm install /absolute/path/to/nestjs-cms-core-0.1.3.tgz
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
an existing revision. Imports still use `"@nestjs-cms/core"`.

### Troubleshooting: Cannot find module `@nestjs-cms/core`

Run `npm ls @nestjs-cms/core` in the consuming application and check that
`node_modules/@nestjs-cms/core/dist/src/index.js` and `index.d.ts` exist. To reinstall
the published package, stop the development server and run:

```sh
npm uninstall @nestjs-cms/core
npm install @nestjs-cms/core
npm run start:dev
```

For Git installations, missing compiled files can indicate an older revision or
a failed `prepare` script. Reinstall with `--foreground-scripts` to see build
output, or use a locally packed package as described above.

## Publishing updates to npm

The authentication package requires the new core integration API. Publish
`@nestjs-cms/core` 0.1.3 first, then `@nestjs-cms/auth` 0.1.0 and
`@nestjs-cms/admin` 0.1.2. Their versions are already prepared in this checkout;
run `release:check` and `release` in each package directory without bumping them
again unless that version has already been published. Nothing is published by
`release:check`.

After confirming `npm view @nestjs-cms/core version` returns the new release,
the owner of the old package can mark it deprecated:

```sh
npm deprecate 'nestjs-cms@*' 'Renamed to @nestjs-cms/core. Install @nestjs-cms/core and update your imports.'
```

This keeps existing versions available while directing users to the new package.
For subsequent releases, follow the steps below.

Run the following commands in the package you changed: the repository root for
`@nestjs-cms/core`, `packages/auth` for `@nestjs-cms/auth`, or
`packages/admin` for `@nestjs-cms/admin`. The packages have
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

- [Authentication, users, roles, and sessions](packages/auth/README.md)
- [Resource definitions, hooks, and service methods](docs/resources.md)
- [API contract and frontend examples](docs/api.md)
- [Environment, databases, storage, and deployment](docs/operations.md)

`ResourceService` is exported for use in other application services. It provides CRUD and `createAttachment`, `findAttachment`, `downloadAttachment`, and `removeAttachment`. All browser attachment traffic goes through the backend API.

User login, roles, sessions, and resource permissions are provided by the optional
[`@nestjs-cms/auth`](packages/auth/README.md) package. Core alone uses API-key
authentication; production requires a server-only key of at least 32 characters.
The auth package validates the session and permissions before supplying that key
internally. It never exposes the key to the browser.

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

The package implements resource discovery, CRUD, filters, transactional hooks, and backend-managed attachments. Import/export, image resizing, encrypted/hashed fields, and automatic relation expansion are not included in core. Resource permissions are available through `@nestjs-cms/auth`. Multilingual and nested fields use JSON. See the [comparison with the original project](docs/resources.md#comparison-with-the-original-project) for differences from `polyu-souvenirs`.

## Reusable admin frontend

The companion React package lives in [packages/admin](packages/admin/README.md).
It provides the portal UI, explicitly configured sections in navigation order,
nested JSON fields, deferred attachments, and inline password actions. It is
packaged independently as `@nestjs-cms/admin`; the core backend package does not
install frontend dependencies. See the package README for build/install steps,
Next.js setup, and authentication/transport adapters.
