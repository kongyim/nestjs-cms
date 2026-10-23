const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createAuthSections } = require('../dist/configs/auth');
test('auth extensions append fields, preserve password handling and do not mutate defaults', () => {
  const [roles, users] = createAuthSections([], {
    users: { defaults: { phone: null }, formFields: [{ field: 'phone', label: 'Phone', type: 'text' }], listFields: [{ field: 'phone', label: 'Phone' }] },
    roles: { defaults: { description: null }, formFields: [{ field: 'description', label: 'Description', type: 'textarea' }] },
  });
  assert.equal(users.defaults.phone, null);
  assert.equal(roles.defaults.description, null);
  assert.equal(users.formFields.at(-1).field, 'phone');
  assert.equal(users.formFields.find(f => f.field === 'password').passwordAction.path('1'), '/auth/users/1/password');
  assert.equal(users.writePermission, 'users:manage');
  assert.equal(createAuthSections([])[1].defaults.phone, undefined);
  assert.throws(() => createAuthSections([], { users: { defaults: { active: false } } }), /Cannot override/);
  assert.throws(() => createAuthSections([], { roles: { formFields: [{ field: 'permissions', type: 'text' }] } }), /Cannot override/);
  assert.throws(() => createAuthSections([], { users: { formFields: [{ field: 'phone', type: 'text' }, { field: 'phone', type: 'text' }] } }), /Duplicate field/);
});
