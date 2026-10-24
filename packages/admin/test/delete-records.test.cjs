const { test } = require('node:test');
const assert = require('node:assert/strict');
const { deleteRecords } = require('../dist/lib/delete-records');

test('bulk deletion uses existing endpoints, encodes IDs and avoids duplicate requests', async () => {
  const calls = [];
  const result = await deleteRecords(
    async (path, options) => calls.push([path, options.method]),
    'pages',
    ['a/b', 'second', 'a/b'],
  );
  assert.deepEqual(calls, [
    ['/pages/a%2Fb', 'DELETE'],
    ['/pages/second', 'DELETE'],
  ]);
  assert.deepEqual(result, { deleted: ['a/b', 'second'], failed: [] });
});

test('bulk deletion reports individual failures and retries only failed records', async () => {
  const calls = [];
  const result = await deleteRecords(
    async (path) => {
      calls.push(path);
      if (path.endsWith('/protected')) throw new Error('Record is referenced');
    },
    'categories',
    ['first', 'protected', 'last'],
  );
  assert.deepEqual(result.deleted, ['first', 'last']);
  assert.deepEqual(result.failed, [
    { id: 'protected', message: 'Record is referenced' },
  ]);
  assert.equal(calls.length, 3);
  const retry = [];
  await deleteRecords(
    async (path) => retry.push(path),
    'categories',
    result.failed.map((item) => item.id),
  );
  assert.deepEqual(retry, ['/categories/protected']);
});

test('generic resource lists expose selection only with write permission', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { AdminContext } = require('../dist/runtime');
  const ResourceSection =
    require('../dist/components/resource-section').default;
  for (const key of ['pages', 'categories', 'custom_resource']) {
    const section = {
      key,
      label: key,
      singular: 'record',
      description: '',
      defaults: {},
      formFields: [],
      listFields: [],
      searchFields: [],
    };
    for (const canWrite of [true, false]) {
      const html = renderToStaticMarkup(
        React.createElement(
          AdminContext.Provider,
          {
            value: {
              config: { sections: [section] },
              api: async () => {},
              notify: () => {},
            },
          },
          React.createElement(ResourceSection, {
            section,
            recordId: null,
            canWrite,
            onAccessChange: async () => {},
          }),
        ),
      );
      assert.equal(html.includes('Select all records on this page'), canWrite);
      assert.equal(html.includes('Delete selected records'), false);
    }
  }
});
