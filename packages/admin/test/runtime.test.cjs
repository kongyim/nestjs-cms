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
    attachments: { documents: [{ id: 'old', name: 'old.txt' }] },
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
  assert.equal(record.attachments.documents[0].id, 'new');
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
