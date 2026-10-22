# @nestjs-cms/admin

A reusable React admin portal for the nestjs-cms CRUD contract. Includes login, permission-aware navigation, resource lists and filters, configurable forms, nested JSON fields, image previews, deferred attachments, and password actions. The backend remains responsible for authentication and authorization.

## Build and install locally

From `nestjs-cms/packages/admin`:

```sh
npm install
npm run build
npm test
npm pack
```

In the consuming application, install the resulting `nestjs-cms-admin-0.1.0.tgz`. This package is not published yet. React 19 and React DOM 19 are peers; Material UI and Emotion are installed with the package. There is no runtime dependency on Next.js or Tailwind. Compiled styles are included.

## Minimal Next.js application

Create `src/sections/pages.ts`. Default-export the section configuration:

```ts
import { defineSection } from '@nestjs-cms/admin';

export default defineSection({
  key: 'pages',
  label: 'Pages',
  singular: 'page',
  description: 'Manage website pages.',
  readPermission: 'pages:read',
  writePermission: 'pages:write',
  defaults: { title: '', translations: { en: '', tc: '', sc: '' } },
  listFields: [{ field: 'title', label: 'Title' }],
  searchFields: [{ field: 'title', label: 'Title', type: 'text' }],
  formFields: [
    { field: 'title', label: 'Title', type: 'text', required: true },
    { field: 'translations.en', label: 'English title', type: 'text' },
    {
      field: 'cover',
      label: 'Cover image',
      type: 'attachment',
      accept: 'image/png,image/jpeg',
    },
  ],
});
```

Add these scripts to your frontend's `package.json`:

```json
{
  "scripts": {
    "dev": "next dev --port 3001",
    "build": "next build",
    "typecheck": "tsc --noEmit"
  }
}
```

Sections are registered explicitly in `admin.config.ts`. Import the sections you want
and list them in navigation order. Only listed sections appear; no generated registry
or discovery command is needed. `defaultSection` chooses the initial screen without
changing navigation order.

Create `src/admin.config.ts` (this example assumes you also defined categories, roles, and users; include only the sections your application needs):

```ts
'use client';
import { defineAdmin } from '@nestjs-cms/admin';
import categories from './sections/categories';
import pages from './sections/pages';
import roles from './sections/roles';
import users from './sections/users';

export default defineAdmin({
  title: 'CMS Workspace',
  apiBaseUrl: '/api',
  defaultSection: 'pages',
  sections: [categories, pages, roles, users],
});
```

Create `app/page.tsx`:

```tsx
'use client';
import { AdminPortal } from '@nestjs-cms/admin';
import config from '../src/admin.config';
export default function Page() {
  return <AdminPortal config={config} />;
}
```

Import `@nestjs-cms/admin/styles.css` once in your root layout. In Next.js with Material UI, keep `AppRouterCacheProvider` from the version-appropriate `@mui/material-nextjs` adapter in the root layout, with `options={{ enableCssLayer: true }}`. `AdminPortal` includes the default theme and CssBaseline; customize with `config.theme` (Material UI theme options). Keep configuration in the client boundary because section actions and renderers can contain functions.

The host owns routing to its API (for example, Next.js rewrites or a reverse proxy), server credentials, and deployment. Never put a shared API key in browser configuration. The portal uses hash routing, so it can also be mounted inside another React application without framework routing integration.

## API and authentication

The default client sends same-origin credentials and `X-CMS-Request: 1`. CRUD responses must follow the nestjs-cms format (`{ data, meta }` for lists). `apiBaseUrl` applies to JSON requests and attachment previews/downloads.

Default session authentication expects `GET /auth/me`, `POST /auth/login` with `{ email, password }`, and `POST /auth/logout`. Identity is `{ id, email, displayName, permissions: string[] }`. These endpoints are provided by the demo backend, **not** by the nestjs-cms core package. Other backends can supply `auth: (api) => ({ getIdentity, login, logout })`.

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
