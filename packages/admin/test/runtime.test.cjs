const { test } = require('node:test');
const assert = require('node:assert/strict');
const { File } = require('node:buffer');
const { createApiClient, createSessionAuth } = require('../dist/lib/api');
const { defineAdmin } = require('../dist/config');
const { readFieldPath, nestFieldValues } = require('../dist/lib/field-paths');
const { passwordChanges } = require('../dist/lib/password-fields');
const { saveAttachments } = require('../dist/lib/attachments');

test('config preserves explicit section order and validates duplicates', () => {
  const sections = [
    { key: 'users', formFields: [] },
    { key: 'pages', formFields: [] },
  ];
  const config = defineAdmin({ sections, defaultSection: 'pages' });
  assert.deepEqual(
    config.sections.map((section) => section.key),
    ['users', 'pages'],
  );
  assert.notEqual(config.sections, sections);
  assert.deepEqual(
    defineAdmin({ sections: [...sections].reverse() }).sections.map(
      (section) => section.key,
    ),
    ['pages', 'users'],
  );
  assert.equal(sections[0].key, 'users');
  assert.throws(
    () => defineAdmin({ sections: [sections[0], sections[0]] }),
    /Duplicate section/,
  );
  assert.throws(
    () => defineAdmin({ sections, defaultSection: 'missing' }),
    /Unknown default/,
  );
});

test('API uses configured URL and headers, preserves multipart boundaries, and reports expired sessions', async () => {
  let request;
  let expired = false;
  let status = 200;
  const api = createApiClient({
    baseUrl: '/custom-api/',
    headers: { 'X-Tenant': 'demo' },
    onUnauthorized: () => {
      expired = true;
    },
    fetch: async (url, options) => {
      request = { url, options };
      return new Response(
        JSON.stringify(status === 200 ? { ok: true } : { message: ['Denied'] }),
        { status },
      );
    },
  });
  await api('/pages', { method: 'POST', body: new FormData() });
  assert.equal(request.url, '/custom-api/pages');
  assert.equal(request.options.headers.get('content-type'), null);
  assert.equal(request.options.headers.get('x-tenant'), 'demo');
  status = 401;
  await assert.rejects(api('/pages'), /Denied/);
  assert.equal(expired, true);
});

test('default session adapter uses host auth endpoints', async () => {
  const calls = [];
  const auth = createSessionAuth(async (path, options) => {
    calls.push({ path, options });
    return { id: 'user' };
  });
  await auth.getIdentity();
  await auth.login({ email: 'a', password: 'b' });
  await auth.logout();
  assert.deepEqual(
    calls.map((x) => x.path),
    ['/auth/me', '/auth/login', '/auth/logout'],
  );
});

test('nested field updates preserve siblings and input records', () => {
  const base = { translations: { en: 'Before', tc: 'Keep' } };
  assert.equal(readFieldPath(base, 'translations.en'), 'Before');
  assert.deepEqual(nestFieldValues([['translations.en', 'After']], base), {
    translations: { en: 'After', tc: 'Keep' },
  });
  assert.equal(base.translations.en, 'Before');
  assert.throws(() => nestFieldValues([['__proto__.polluted', true]], {}));
});

test('password actions skip blank values and preserve whitespace', () => {
  const fields = [
    {
      type: 'password',
      field: 'password',
      label: 'Password',
      minLength: 12,
      passwordAction: { path: (id) => `/auth/users/${id}/password` },
    },
  ];
  assert.equal(passwordChanges(fields, { password: '' }).length, 0);
  assert.throws(() => passwordChanges(fields, { password: 'short' }));
  assert.equal(
    passwordChanges(fields, { password: '  long-password  ' })[0].password,
    '  long-password  ',
  );
});

test('deferred attachments acknowledge successes and retry remaining requests', async () => {
  const removal = { kind: 'remove', field: 'documents', id: 'old' };
  const upload = {
    kind: 'upload',
    field: 'documents',
    multiple: true,
    file: new File(['x'], 'new.txt'),
  };
  let pending = [removal, upload];
  let record = {
    id: 'page',
    documents: [{ id: 'old', name: 'old.txt' }],
  };
  const calls = [];
  let fail = true;
  const api = async (path, options) => {
    calls.push(options.method);
    if (fail && options.method === 'POST') throw new Error('Upload failed');
    return { id: 'new', name: 'new.txt' };
  };
  const acknowledge = (change, updated) => {
    record = updated;
    pending = pending.filter((x) => x !== change);
  };
  assert.equal(calls.length, 0);
  await assert.rejects(
    saveAttachments(api, 'pages', record, pending, acknowledge),
  );
  assert.equal(pending.length, 1);
  fail = false;
  await saveAttachments(api, 'pages', record, pending, acknowledge);
  assert.deepEqual(calls, ['DELETE', 'POST', 'POST']);
  assert.equal(pending.length, 0);
  assert.equal(record.documents[0].id, 'new');
});

test('generic renderer preserves field order, nested defaults, and custom controls', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { AdminContext } = require('../dist/runtime');
  const ResourceSection =
    require('../dist/components/resource-section').default;
  const section = {
    key: 'products',
    label: 'Products',
    singular: 'product',
    description: 'Catalog',
    defaults: {
      title: 'Demo',
      translations: { en: 'English title' },
      custom: 'Custom value',
    },
    listFields: [],
    searchFields: [],
    formFields: [
      { field: 'title', label: 'Product title', type: 'text' },
      {
        field: 'cover',
        label: 'Product image',
        type: 'attachment',
        accept: 'image/png',
      },
      { field: 'translations.en', label: 'English translation', type: 'text' },
      { field: 'custom', label: 'Custom', type: 'custom' },
      {
        field: 'password',
        label: 'Product password',
        type: 'password',
        passwordAction: { path: (id) => `/password/${id}` },
      },
    ],
  };
  const config = {
    sections: [section],
    fieldRenderers: {
      custom: ({ values }) =>
        React.createElement('output', null, values.custom),
    },
  };
  const html = renderToStaticMarkup(
    React.createElement(
      AdminContext.Provider,
      { value: { api: async () => {}, config } },
      React.createElement(ResourceSection, {
        section,
        recordId: 'new',
        canWrite: true,
        onAccessChange: async () => {},
      }),
    ),
  );
  assert(html.indexOf('Product title') < html.indexOf('Product image'));
  assert(html.indexOf('Product image') < html.indexOf('English translation'));
  assert.match(html, /value="English title"/);
  assert.match(html, /<output>Custom value<\/output>/);
  assert.match(html, /type="password"/);
  assert.doesNotMatch(html, /Confirm password/);
});

test('responsive layouts default to full width on mobile and allow explicit breakpoints', () => {
  const { gridColumns } = require('../dist/lib/form-layout');
  assert.deepEqual(gridColumns(), { xs: 'span 12 / span 12' });
  assert.deepEqual(gridColumns(6), {
    xs: 'span 12 / span 12',
    md: 'span 6 / span 6',
  });
  assert.deepEqual(gridColumns(4), {
    xs: 'span 12 / span 12',
    md: 'span 4 / span 4',
  });
  assert.deepEqual(gridColumns({ xs: 12, sm: 6, lg: 4 }), {
    xs: 'span 12 / span 12',
    sm: 'span 6 / span 6',
    lg: 'span 4 / span 4',
  });
});

test('groups flatten in display order for values, lookups, and special save actions', () => {
  const { flattenFields } = require('../dist/lib/form-layout');
  const { defineSection } = require('../dist/config');
  const fields = [
    {
      type: 'group',
      key: 'main',
      label: 'Main',
      fields: [
        { field: 'translations.en', type: 'text', label: 'English', width: 6 },
        {
          type: 'group',
          key: 'nested',
          label: 'Nested',
          fields: [
            {
              field: 'roleId',
              type: 'select',
              itemsFrom: { resource: 'roles', labelField: 'name' },
            },
            { field: 'cover', type: 'attachment' },
            {
              field: 'password',
              type: 'password',
              passwordAction: { path: (id) => `/password/${id}` },
            },
          ],
        },
      ],
    },
    { field: 'title', type: 'text' },
  ];
  const flat = flattenFields(fields);
  assert.deepEqual(
    flat.map((field) => field.field),
    ['translations.en', 'roleId', 'cover', 'password', 'title'],
  );
  assert.equal(
    flat.filter((field) => field.itemsFrom)[0].itemsFrom.resource,
    'roles',
  );
  assert.equal(
    passwordChanges(flat, { password: 'unchanged password' })[0].field,
    'password',
  );
  const payload = nestFieldValues(
    flat
      .filter((field) => !['attachment', 'password'].includes(field.type))
      .map((field) => [
        field.field,
        field.field === 'translations.en' ? 'Updated' : 'value',
      ]),
    { translations: { en: 'Old', tc: 'Keep' } },
  );
  assert.deepEqual(payload, {
    translations: { en: 'Updated', tc: 'Keep' },
    roleId: 'value',
    title: 'value',
  });
  assert.doesNotThrow(() => defineSection({ key: 'test', formFields: fields }));
  assert.throws(
    () =>
      defineSection({
        key: 'test',
        formFields: [...fields, { field: 'translations.en', type: 'text' }],
      }),
    /Duplicate field/,
  );
  assert.throws(
    () =>
      defineSection({
        key: 'test',
        formFields: [
          {
            type: 'group',
            key: 'bad',
            label: 'Bad',
            fields: [{ field: 'title', type: 'text', width: 13 }],
          },
        ],
      }),
    /widths/,
  );
  assert.throws(
    () => defineSection({ key: 'test', formFields: [fields[0], fields[0]] }),
    /group key/,
  );
});

test('grouped editor renders all field controls inline with responsive grids', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { AdminContext } = require('../dist/runtime');
  const ResourceSection =
    require('../dist/components/resource-section').default;
  const section = {
    key: 'pages',
    label: 'Pages',
    singular: 'page',
    description: '',
    defaults: { translations: { en: 'English' }, title: 'Title' },
    listFields: [],
    searchFields: [],
    formFields: [
      {
        type: 'group',
        key: 'content',
        label: 'Content group',
        description: 'Group description',
        fields: [
          { field: 'title', label: 'Page title', type: 'text', width: 6 },
          {
            field: 'translations.en',
            label: 'English title',
            type: 'text',
            width: 6,
          },
          {
            field: 'cover',
            label: 'Cover image',
            type: 'attachment',
            width: 4,
          },
          {
            field: 'password',
            label: 'Password',
            type: 'password',
            width: 4,
            passwordAction: { path: (id) => `/password/${id}` },
          },
        ],
      },
    ],
  };
  const html = renderToStaticMarkup(
    React.createElement(
      AdminContext.Provider,
      { value: { api: async () => {}, config: { sections: [section] } } },
      React.createElement(ResourceSection, {
        section,
        recordId: 'new',
        canWrite: true,
        onAccessChange: async () => {},
      }),
    ),
  );
  assert.match(html, /<fieldset/);
  assert.match(html, /<legend[^>]*>Content group/);
  assert.match(html, /Group description/);
  assert.match(html, /value="English"/);
  assert.match(html, /Cover image/);
  assert.match(html, /type="password"/);
  assert.match(html, /grid-template-columns:repeat\(12, minmax\(0, 1fr\)\)/);
  assert.match(html, /grid-column:span 6\s*\/\s*span 6/);
  assert.doesNotMatch(html, /max-w-3xl/);
});

test('attachment list cells render previews, filenames, empty states, and configured URLs', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { AdminContext } = require('../dist/runtime');
  const Cell = require('../dist/components/attachment-list-cell').default;
  const image = { id: 'image/id', name: 'Cover photo', mimeType: 'image/png' };
  function render(value, config = {}) {
    return renderToStaticMarkup(
      React.createElement(
        AdminContext.Provider,
        { value: { api: async () => {}, config: { sections: [], ...config } } },
        React.createElement(Cell, {
          resource: 'pages',
          field: 'cover',
          record: { id: 'page/id', cover: value },
        }),
      ),
    );
  }
  const html = render(image, { apiBaseUrl: '/custom-api/' });
  assert.match(
    html,
    /src="\/custom-api\/pages\/page%2Fid\/attachments\/cover\/image%2Fid"/,
  );
  assert.match(html, /alt="Cover photo"/);
  assert.match(html, /loading="lazy"/);
  assert.equal(render(null), '—');
  assert.equal(render([]), '—');
  const multiple = render([
    image,
    { id: 'pdf', name: 'Document.pdf', mimeType: 'application/pdf' },
  ]);
  assert.match(multiple, /<img/);
  assert.match(multiple, /Document.pdf/);
  assert.equal((multiple.match(/<img/g) ?? []).length, 1);
  assert.match(
    render(image, { attachmentUrl: (path) => `/download${path}` }),
    /src="\/download\/pages\//,
  );
});
