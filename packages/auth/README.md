# @nestjs-cms/auth

Users, roles, password authentication, and database-backed sessions for
`@nestjs-cms/core`. One module registers the built-in resources, internal auth
tables, authentication endpoints, and server-side permissions. React consumers
use `@nestjs-cms/admin` separately.

## Install

Use Node.js 22+, NestJS 11 with Express, and PostgreSQL or MySQL:

```sh
npm install @nestjs-cms/core@latest @nestjs-cms/auth@latest
```

Requires core 0.1.3 or newer within the 0.1 series. Import **only**
`CmsAuthModule.forRoot` for this CMS instance; do not additionally import
`ResourceModule.forRoot` or register your own `users` and `roles` resource files.

## Configure once

Load the application's environment before importing the module. In `app.module.ts`:

```ts
import "dotenv/config";
import { Module } from "@nestjs/common";
import { join } from "node:path";
import { CmsAuthModule } from "@nestjs-cms/auth";

@Module({
  imports: [
    CmsAuthModule.forRoot({
      resourcesPath: join(__dirname, "resources"),
      adminOrigin: process.env.ADMIN_ORIGIN ?? "http://localhost:3001",
      adminBasePath: process.env.ADMIN_BASE_PATH ?? "/admin",
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

The host still starts NestJS, configures its port, and loads its database and S3
settings. Do not add a global `/api` prefix; the routes already include it. A
workspace should load its root `.env` explicitly as shown in the
[root walkthrough](../../README.md#build-a-cms-from-scratch).

For initial local development:

```dotenv
NODE_ENV=development
DB_SYNCHRONIZE=true
ADMIN_ORIGIN=http://localhost:3001
ADMIN_BASE_PATH=/admin
ADMIN_BOOTSTRAP_EMAIL=admin@example.com
ADMIN_BOOTSTRAP_PASSWORD=replace-with-a-unique-long-password
ADMIN_API_KEY=
```

Also set the core database credentials and storage settings. The bootstrap
password must be 12–128 characters. On an empty users table, startup creates an
Administrator role with all configured permissions and an administrator account.
Remove both bootstrap environment variables after the first successful startup.
Existing accounts and passwords are never overwritten. Bootstrap is intended to
run on a single application instance during initial provisioning.

Schema synchronization creates tables only when explicitly enabled in development.
Production needs migrations, not synchronization. Sessions persist in the database
across restarts; current user status and role permissions are checked on every
request. Password changes revoke all sessions for that account.

## Built-in resources and permissions

| Resource | Fields                                     | Required permission               |
| -------- | ------------------------------------------ | --------------------------------- |
| `users`  | `email`, `displayName`, `roleId`, `active` | `users:manage` for all operations |
| `roles`  | `name`, `permissions`                      | `users:manage` for all operations |

Email addresses are normalized and unique. Users have one role and cannot log in
until a password has been set. Referenced roles cannot be deleted. Internal
`admin_credentials` and `admin_sessions` tables are not CRUD resources, and
password hashes and tokens are never returned by user endpoints.

Application resources default to `<resource>:read` for GET/HEAD requests and
`<resource>:write` for mutations, including attachment upload and removal. File
downloads require read permission. Give an editor both read and write permissions.
`GET /api/_resources` requires `users:manage`.

You can share permissions across resources:

```ts
resourcePermissions: {
  categories: { read: 'pages:read', write: 'pages:write' },
},
```

Mappings must refer to existing application resources. The package reserves
`users`, `roles`, `auth`, `admin_credentials`, and `admin_sessions`; built-in
management permissions cannot be overridden. Unknown resource routes are denied.

New permissions are allowed in roles immediately after a configuration change,
but existing roles are not automatically granted them. Update the Administrator
role explicitly when adding resources. Anyone with `users:manage` can manage all
accounts and grant permissions; reserve it for trusted administrators. Keep an
active administrator account when editing users and roles.

The guard protects CMS and authentication controllers only. Other application
controllers retain their existing authorization. `AuthService.authenticate(token)`
is available for your own guards; never rely on frontend navigation permissions
to protect a custom backend endpoint.

## Admin UI

The default admin authentication adapter works without customization. Set
`apiBaseUrl` to your same-origin proxy and add the built-in management sections:

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

`createAuthSections` adds Roles and Users, including role assignment, active status,
and the password action. It always includes the `users:manage` permission choice.
Supply the same application permission names configured in the API. Section order
is explicit; you can customize the returned section configurations.

The browser proxy path and cookie path must match. `adminBasePath: '/admin'`
sets cookies on `/admin/api`; `adminBasePath: ''` uses `/api`. Configure your
frontend's base path and proxy accordingly. Restart and sign in again after a path
change; rebuild Next.js when its base path changes.

## Authentication API

| Endpoint                           | Behavior                                                              |
| ---------------------------------- | --------------------------------------------------------------------- |
| `POST /api/auth/login`             | `{ email, password }`; returns identity and sets the session cookie   |
| `GET /api/auth/me`                 | Returns `{ id, email, displayName, permissions }`                     |
| `POST /api/auth/logout`            | Revokes the session and clears its cookie                             |
| `PUT /api/auth/users/:id/password` | `{ password }`; requires `users:manage`, revokes that user's sessions |

All mutations require `X-CMS-Request: 1`. If an `Origin` header is present it must
exactly match `adminOrigin`; the default admin client supplies the required header.
Use a cookie-aware client and the browser-facing proxy URL. There is no public
registration, email password recovery, or OAuth flow.

Passwords use salted asynchronous scrypt. Only SHA-256 digests of random session
tokens are stored. Cookies are HttpOnly, SameSite=Strict, and Secure when
`NODE_ENV=production`. Sessions expire after eight hours by default; override
`sessionLifetimeMs` between one minute and 30 days. Expired sessions are removed
on successful login.

Login attempts are limited to ten per IP and 100 globally per minute per process.
Multiple API instances need shared ingress or application rate limiting. Proxy
addresses are not trusted automatically. Requests without a session are rejected
even if they carry `X-API-Key`; the guard supplies the configured shared key to the
core only after authentication and permission checks.

## Schema migrations and deployment

Use HTTPS and set `NODE_ENV=production`, an HTTPS `adminOrigin`,
`DB_SYNCHRONIZE=false`, and a server-only `ADMIN_API_KEY` of at least 32 characters
(the current core production requirement). Configure the same options on every
instance. The API never sends this key to the frontend.

Export the complete data source from your application's TypeORM migration entry
point, using the same resource configuration as runtime:

```ts
import "dotenv/config";
import { join } from "node:path";
import { createAuthDataSource } from "@nestjs-cms/auth";

const { dataSource } = createAuthDataSource(
  {
    resourcesPath: join(__dirname, "resources"),
    // Use '.ts' with a TypeScript migration runner; '.js' for compiled files.
    extension: __filename.endsWith(".ts") ? ".ts" : ".js",
    adminOrigin: process.env.ADMIN_ORIGIN!,
  },
  { migrations: [join(__dirname, "migrations/*{.ts,.js}")] },
);

export default dataSource;
```

This includes resource tables, attachments, roles, users, credentials, sessions,
and foreign keys. Generate, review, and apply migrations with TypeORM before
starting the API. The package does not run migrations or ship a migration that
assumes your application's existing schema. When adopting the package in the demo,
its existing auth table names and password/session formats are compatible; review
the generated schema diff before applying any changes.

## Develop and release

From the library checkout, build core first, then work in this package:

```sh
npm run build
cd packages/auth
npm ci
npm test
npm run build
npm pack --dry-run
```

The development dependency installs the local core package using `install-links`
from `.npmrc`; consumers resolve the published core peer dependency. After core
changes, rebuild it and reinstall the local dependency with `npm ci` here.

Integration tests require a fresh disposable PostgreSQL database whose name ends
in `_test`; they create users and content. Never use a development or production
database:

```sh
AUTH_TEST_DATABASE=1 NODE_ENV=test DB_TYPE=postgres DB_HOST=127.0.0.1 \
DB_PORT=55449 DB_USERNAME=cms_test DB_PASSWORD=cms_test_local \
DB_DATABASE=cms_auth_test DB_SYNCHRONIZE=true ADMIN_API_KEY=integration-test-key \
npm run test:integration
```

Release core 0.1.3 or newer first, then release this package and the updated admin
package independently. From each package directory, use `npm run release:check`
and `npm run release`; use the version scripts for subsequent releases. No
publishing is performed by a build or test command.

## Migrating the demo

1. Install the latest core, auth, and admin packages in their respective workspaces.
2. Replace the demo's manual data source, entity registration, auth controller,
   service, and global guard with `CmsAuthModule.forRoot`. Keep unrelated host
   controllers/providers. Do not register `ResourceModule.forRoot` separately.
3. Remove the copied `src/auth` implementation and `resources/users.ts` and
   `resources/roles.ts`. The package owns those definitions. Update any tests
   importing `Credential` or `Session` to import them from `@nestjs-cms/auth`.
   Set test environment variables before importing the host module: `forRoot`
   resolves its options when the module is imported, not when Nest starts.
4. Preserve the existing `.env` bootstrap values, origin, and base path by passing
   them to the module, as in the configuration example above.
5. Map category reads to `pages:read` and writes to `pages:write` using
   `resourcePermissions`, as shown above, to preserve the demo's access policy.
6. Replace copied Roles/Users frontend sections with `createAuthSections`, or keep
   your custom UI configurations. Existing authentication endpoints and payloads
   are unchanged.
7. Review a schema diff against your existing database before deployment. Existing
   tables, password hashes, and session digests use the same names and formats;
   do not delete the database or rerun bootstrap to migrate an existing account.

The demo in the sibling checkout can be tested with locally packed versions before
publishing. Consumer documentation assumes the releases are available from npm.

## Extend users and roles

`CmsAuthModule.forRoot` and `createAuthDataSource` accept `resourceExtensions`:

```ts
resourceExtensions: {
  users: {
    schema: z.object({ phone: z.string().max(30).nullable().default(null) }),
    columns: { phone: { type: String, length: 30, nullable: true } },
    filterable: ['phone'],
  },
  roles: {
    schema: z.object({ description: z.string().max(500).nullable().default(null) }),
    columns: { description: { type: String, length: 500, nullable: true } },
  },
}
```

Import `z` from `@nestjs-cms/core`. Extensions add schema fields and matching columns,
and may append filterable/sortable fields. Existing auth fields, resource names,
foreign keys, and permissions remain controlled by the package. Field validators
must accept omitted values through defaults or optional schemas; omitted/null values
need nullable or database-defaulted columns. Bootstrap uses the extended schemas.
Object-level extension refinements are not merged: define validation on each field.
Generate/review a database migration using the same options with
`createAuthDataSource`; SQL column defaults or a backfill may be needed for existing
rows. Schema defaults alone do not backfill a database. Extra fields are available
on resource endpoints, not automatically added to the authentication identity.

## Publishing updates to npm

Run these commands from `packages/auth`:

```sh
npm ci
npm run release:check
npm run version:patch
npm run release
```

- `release:check` runs tests, builds the package, and previews its npm contents
  without publishing.
- `version:patch` updates `package.json` and `package-lock.json`, without creating
  a Git commit or tag. Use `version:minor` or `version:major` for larger releases.
- `release` publishes publicly to npm. The publish lifecycle runs tests and builds
  the package before uploading it.

For the first publication, you can omit `version:patch` if the current version
has never been published. Likewise, do not bump again if you already prepared the
release version. If needed, run `npm login --auth-type=web` first, then use
`npm whoami` to check the account. Publishing requires permission for the
`@nestjs-cms` scope. Commit the version and lockfile changes after release.

Publish a compatible core release first (currently `^0.1.3`). For a fresh
checkout, run `npm ci` and `npm run build` at the repository root before entering
`packages/auth`; the development dependency installs a built local copy of core.
