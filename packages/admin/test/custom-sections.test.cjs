const { test } = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { defineAdmin, defineCustomSection } = require('../dist/config');
const { useAdmin } = require('../dist');
const { AdminContext } = require('../dist/runtime');
const SectionContent = require('../dist/components/section-content').default;

test('custom sections mix with legacy resource sections without CRUD fields', () => {
  const dashboard = defineCustomSection({
    key: 'dashboard',
    label: 'Dashboard',
    component: () => null,
  });
  const pages = { key: 'pages', formFields: [] };
  const config = defineAdmin({
    sections: [dashboard, pages],
    defaultSection: 'dashboard',
  });
  assert.deepEqual(
    config.sections.map((s) => s.key),
    ['dashboard', 'pages'],
  );
  assert.equal(dashboard.type, 'custom');
  assert.throws(
    () =>
      defineAdmin({ sections: [dashboard, { ...pages, key: 'dashboard' }] }),
    /Duplicate section/,
  );
  assert.throws(
    () => defineAdmin({ sections: [{ ...dashboard, key: 'bad-key' }] }),
    /Invalid section key/,
  );
  assert.throws(
    () => defineAdmin({ sections: [dashboard], defaultSection: 'missing' }),
    /Unknown default/,
  );
  assert.throws(
    () => defineAdmin({ sections: [{ ...dashboard, component: undefined }] }),
    /needs a component/,
  );
  assert.throws(
    () =>
      defineAdmin({
        sections: [
          { ...pages, formFields: [{ field: 'password', type: 'password' }] },
        ],
      }),
    /passwordAction/,
  );
});

test('custom page renders with admin context without mounting CRUD or requesting resource data', () => {
  const api = () => {
    throw new Error('Unexpected CRUD request');
  };
  function Dashboard() {
    const runtime = useAdmin();
    assert.equal(runtime.api, api);
    return React.createElement('h1', null, runtime.config.title);
  }
  const section = defineCustomSection({
    key: 'dashboard',
    label: 'Dashboard',
    component: Dashboard,
  });
  const config = defineAdmin({
    title: 'Custom dashboard',
    sections: [section],
  });
  const html = renderToStaticMarkup(
    React.createElement(
      AdminContext.Provider,
      { value: { api, config } },
      React.createElement(SectionContent, {
        section,
        recordId: 'new',
        canWrite: false,
        onAccessChange: async () => {},
      }),
    ),
  );
  assert.equal(html, '<h1>Custom dashboard</h1>');
});
