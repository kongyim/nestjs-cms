# @nestjs-cms/admin

A reusable React admin portal for the nestjs-cms CRUD contract. Includes login, permission-aware navigation, resource lists and filters, configurable forms, nested JSON fields, image previews, deferred attachments, and password actions. The backend remains responsible for authentication and authorization.

## Install

In your React application:

```sh
npm install @nestjs-cms/admin
```

React 19 and React DOM 19 are peers; Material UI and Emotion are installed with
the package. There is no runtime dependency on Next.js or Tailwind. Compiled
styles are included.

## Quick start: a new Next.js application

This example creates a Next.js 15 App Router application with one **Pages** section.
Use Node.js 22 or newer. You also need a running backend at
`http://localhost:3000/api` with a `pages` resource and the session endpoints
listed under [API and authentication](#api-and-authentication). The admin package
provides the UI; it does not start a backend or create login accounts.

### 1. Create your Next.js project and install the package

In the directory where you want your new project:

```sh
npx create-next-app@15 my-admin --ts --app --src-dir --eslint --no-tailwind --use-npm --import-alias "@/*"
cd my-admin
npm install @nestjs-cms/admin
npm install @mui/material-nextjs@9 @emotion/cache
```

If prompted about additional optional features, keep the defaults. The admin package requires
React 19 and React DOM 19, which this Next.js App Router setup uses.

### 2. Configure one resource

Create `src/admin.config.ts`:

```ts
'use client';

import { defineAdmin, defineSection } from '@nestjs-cms/admin';

const pages = defineSection({
  key: 'pages',
  label: 'Pages',
  singular: 'page',
  readPermission: 'pages:read',
  writePermission: 'pages:write',
  defaults: { title: '' },
  listFields: [{ field: 'title', label: 'Title' }],
  formFields: [
    { field: 'title', label: 'Title', type: 'text', required: true },
  ],
});

export default defineAdmin({
  title: 'My Admin',
  apiBaseUrl: '/api',
  defaultSection: 'pages',
  sections: [pages],
});
```

The section key `pages` maps to `/api/pages`. Match the fields and permissions to
your backend resource. Add more sections to `sections` in navigation order;
`defaultSection` chooses the initial screen. Keep configuration in the client
boundary because actions and renderers can contain functions.

### 3. Display the portal

Replace `src/app/page.tsx` with:

```tsx
'use client';

import { AdminPortal } from '@nestjs-cms/admin';
import config from '../admin.config';

export default function Page() {
  return <AdminPortal config={config} />;
}
```

Replace `src/app/layout.tsx` with:

```tsx
import type { ReactNode } from 'react';
import { AppRouterCacheProvider } from '@mui/material-nextjs/v15-appRouter';
import '@nestjs-cms/admin/styles.css';

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

This follows the [Material UI Next.js integration](https://mui.com/material-ui/integrations/nextjs/).
`AdminPortal` supplies the default theme and CssBaseline. You can customize the
theme later with `config.theme`.

### 4. Connect your backend

Replace `next.config.ts` at the project root with:

```ts
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'http://localhost:3000/api/:path*',
      },
    ];
  },
};

export default nextConfig;
```

Change `destination` if your backend uses another address. This forwards browser
requests through Next.js, keeping API requests and session cookies on the same
origin. Never put a shared API key in browser configuration.

### 5. Start the portal

With your backend running, start Next.js on a separate port:

```sh
npm run dev -- --port 3001
```

Open <http://localhost:3001> and sign in with an existing backend account that has
`pages:read` and `pages:write` permissions. You should see the Pages list and be
able to create a page with a title. If your backend requires more fields, add them
to `defaults` and `formFields` first. A login error or API 404 means you should
check the backend address and authentication endpoints above.

The portal uses hash routing and can also be mounted in another React application
without framework routing integration.

## API and authentication

The default client sends same-origin credentials and `X-CMS-Request: 1`. CRUD responses must follow the nestjs-cms format (`{ data, meta }` for lists). `apiBaseUrl` applies to JSON requests and attachment previews/downloads.

Default session authentication expects `GET /auth/me`, `POST /auth/login` with `{ email, password }`, and `POST /auth/logout`. Identity is `{ id, email, displayName, permissions: string[] }`. These endpoints are provided by [`@nestjs-cms/auth`](../auth/README.md), **not** by the `@nestjs-cms/core` package. Other backends can supply `auth: (api) => ({ getIdentity, login, logout })`.

Provide `request: ApiClient` to replace the transport, or build one with `createApiClient({ baseUrl, credentials, headers, fetch, onUnauthorized })`. A custom transport should handle its own session-expiration behavior. Use `attachmentUrl(path)` if previews/downloads need a different URL. Image/download requests use browser URLs, not the JSON adapter; for header-based authentication, provide an authenticated same-origin endpoint or an appropriate download URL.

Default access checks match `readPermission` and `writePermission` against the identity's permissions. Omitted permissions mean allowed in the UI. Override `canAccess(identity, permission)` to integrate another permission model. UI checks never replace server authorization.

## Fields

Built-in types: `text`, `email`, `url`, `textarea`, `number`, `date`, `datetime-local` (UTC), `json`, `select`, `checkbox`, `checkboxes`, `attachment`, and `password`. All controls appear in `formFields` order. `itemsFrom` loads select options from another resource.

### Responsive widths and groups

The portal and editor use the full available content width. Forms use a 12-column
grid. Fields without `width` occupy a full row. Set `width: 6` for two columns,
`width: 4` for three, or `width: 3` for four. Numeric widths apply from the theme's
`md` breakpoint; fields stack on smaller screens. For finer control, use
`width: { xs: 12, sm: 6, lg: 4 }`.

Organize long forms with groups inside `formFields`:

```ts
formFields: [
  {
    type: 'group',
    key: 'details',
    label: 'Page details',
    description: 'Manage the title and status.',
    fields: [
      { field: 'title', label: 'Title', type: 'text', width: 6 },
      { field: 'status', label: 'Status', type: 'select', width: 6,
        items: [{ value: 'draft', label: 'Draft' }, { value: 'published', label: 'Published' }] },
    ],
  },
  {
    type: 'group',
    key: 'translations',
    label: 'Translated titles',
    fields: [
      { field: 'translations.en', label: 'English', type: 'text', width: 4 },
      { field: 'translations.tc', label: 'Traditional Chinese', type: 'text', width: 4 },
      { field: 'translations.sc', label: 'Simplified Chinese', type: 'text', width: 4 },
    ],
  },
],
```

Groups can also have a `width` and contain nested groups. Child widths are relative
to their group's grid. Give each group a unique `key`. Fields and groups appear in
array order; groups only affect presentation, not API payloads. Existing flat
forms remain supported. Related-record options, nested JSON, attachments, custom
renderers, and password actions work within groups as before.

Dot paths such as `translations.en` read nested objects and write the complete JSON column while preserving unedited siblings. Arrays are edited through JSON or checkbox controls, not indexed dot paths.

Attachments use `accept` and optional `multiple`. Uploads and removals stay pending until Save; image previews work for both saved and selected files. Saving creates/updates the record first, then applies attachments and password actions. These are separate HTTP requests, not an atomic transaction. Successful attachment operations are acknowledged individually; remaining changes can be retried after a failure.

Passwords are write-only and excluded from ordinary resource payloads:

```ts
{
  field: 'password', label: 'Password', type: 'password',
  minLength: 12, maxLength: 128,
  hint: 'Leave blank to keep the existing password.',
  passwordAction: { path: id => `/auth/users/${encodeURIComponent(id)}/password` },
}
```

Blank passwords are skipped. Non-empty passwords are sent unchanged via `PUT { password }` after the record exists.

For a custom control, register a React component in `fieldRenderers: { customType: MyField }`. It receives `{ field, values, disabled, onChange }`; use `values[field.field]` and pass updated values to `onChange`. An optional field-level `serialize(value, values)` converts the value before the ordinary resource request. Built-in attachment/password save semantics still apply to those types.

### Attachment columns in lists

Add `{ field: 'cover', label: 'Cover', type: 'attachment' }` to `listFields`
to show image thumbnails from `record.attachments.cover`. The type is also
inferred if the matching form field is an attachment, including inside groups.
Multiple attachments render together; non-image files display their names, and
empty fields display a dash. Previews use `apiBaseUrl` or `attachmentUrl`, just
like the editor, and clicking the row still opens the record.

## Build and install locally (contributors)

To try unpublished changes, run these commands from `nestjs-cms/packages/admin`:

```sh
npm install
npm test
npm pack
```

`npm pack` builds the package automatically. Install the resulting tarball in
your consuming application, replacing the path with its actual location:

```sh
npm install /path/to/nestjs-cms/packages/admin/nestjs-cms-admin-0.1.2.tgz
```

## Publishing updates to npm

From `packages/admin`, after making your changes:

```sh
npm ci
npm run release:check
npm run version:patch
npm run release
```

`release:check` tests, builds, and previews the package without publishing.
`version:patch` updates the version in both package files automatically (for example,
`0.1.0` → `0.1.1`); use `version:minor` or `version:major` for larger releases.
`release` tests again, builds, and publishes publicly. Complete npm's authentication
prompt when requested. Commit and push the source and version changes afterward.

The admin and backend are released independently. Each published update needs a
new version. If publishing fails, retry `npm run release` without another bump
as long as that version was not published. See the repository's
[publishing guide](../../README.md#publishing-updates-to-npm) for version choices
and recovery steps.

## Custom pages

Use `defineCustomSection` for dashboards, reports, or other React pages:

```tsx
import { defineAdmin, defineCustomSection, useAdmin } from '@nestjs-cms/admin';

function Dashboard() {
  const { config, api } = useAdmin();
  // Use api<T>('/your-endpoint') in an effect or event handler to load data.
  return <h1>{config.title}</h1>;
}

const dashboard = defineCustomSection({
  key: 'dashboard',
  label: 'Dashboard',
  component: Dashboard,
  // readPermission: 'dashboard:read',
});

export default defineAdmin({
  sections: [dashboard], // May be mixed with existing defineSection() resources.
  defaultSection: 'dashboard',
});
```

Custom components render inside the authenticated shell and theme at `#/dashboard`.
`readPermission` uses the same access policy as resource sections; omitting it
allows any signed-in user under the default policy. Backend endpoints must enforce
their own permissions. Custom pages do not require CRUD fields or issue automatic
resource requests. They own their heading, loading, and error UI. `useAdmin()`
exposes the configured `api` and `config`, and must be used inside `AdminPortal`.
Existing `SectionConfig` remains the resource type; `AdminSectionConfig` is the
union of resource and custom sections. In Next.js, import configuration containing
components from a client entry point, rather than passing it across a server boundary.

## Built-in user and role editors

When using `@nestjs-cms/auth`, add its management sections without copying forms:

```ts
import { defineAdmin, createAuthSections } from '@nestjs-cms/admin';

export default defineAdmin({
  apiBaseUrl: '/admin/api',
  sections: [
    ...createAuthSections([
      { value: 'pages:read', label: 'View pages' },
      { value: 'pages:write', label: 'Edit pages' },
    ]),
  ],
});
```

This returns Roles then Users, protected by `users:manage`, with password actions
and role selection already configured. Add your resource sections to the same
array. Supply permission names matching your API configuration; `users:manage`
is always included in the role editor. Backend authorization remains required.

## Add fields to auth editors

Pass an optional second argument to `createAuthSections(permissions, extensions)`:

```ts
createAuthSections([], {
  users: {
    defaults: { phone: null },
    formFields: [
      { field: 'phone', label: 'Phone', type: 'text', nullable: true },
    ],
    listFields: [{ field: 'phone', label: 'Phone' }],
  },
  roles: {
    defaults: { description: null },
    formFields: [
      {
        field: 'description',
        label: 'Description',
        type: 'textarea',
        nullable: true,
      },
    ],
  },
});
```

Defaults are merged; form, list, and search fields are appended. Built-in form
fields/defaults cannot be overridden. Existing calls without extensions retain
their behavior. Configure matching `resourceExtensions` in `@nestjs-cms/auth`
and migrate the database before saving these fields.

## Database import action

Set `databaseImport: { label: 'Import database' }` in `defineAdmin` to show an action
below the sections. It defaults to `POST /database/import` through the configured API
client and is visible to `users:manage`. Configure the authenticated endpoint with
`@nestjs-cms/import`. The action reports progress, errors, and counts, then refreshes
the displayed section. Optional `path` and `permission` affect the client only; server
permissions cannot be overridden by configuration in the browser.

## Notifications

The portal displays feedback in Material UI snackbars at the bottom-right,
including sign-in errors, imports, resource saves/deletes, field-option loading,
and attachment validation. Messages queue rather than overlap. Success and info
messages dismiss after six seconds; errors and warnings stay until dismissed.
Clicking elsewhere does not dismiss a notification. Field-option errors retain
their Retry action.

Custom pages can use the same queue through `useAdmin()`:

```tsx
const { notify } = useAdmin();

// In an event handler or effect:
notify('Changes saved.', 'success');
notify('Could not load the report.', 'error', {
  label: 'Retry',
  onClick: reloadReport,
});
```
