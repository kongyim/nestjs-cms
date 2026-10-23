const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createAuthSections } = require("../dist/configs/auth");

test("auth sections require management rights and use the password endpoint", () => {
  const input = [{ value: "pages:read", label: "Read pages" }];
  const [roles, users] = createAuthSections(input);
  assert.equal(input.length, 1);
  for (const section of [roles, users]) {
    assert.equal(section.readPermission, "users:manage");
    assert.equal(section.writePermission, "users:manage");
  }
  assert.deepEqual(
    roles.formFields
      .find((field) => field.field === "permissions")
      .items.map((item) => item.value),
    ["pages:read", "users:manage"],
  );
  const password = users.formFields.find((field) => field.field === "password");
  assert.equal(
    password.passwordAction.path("user/id"),
    "/auth/users/user%2Fid/password",
  );
  assert.equal(
    users.formFields.find((field) => field.field === "roleId").itemsFrom
      .resource,
    "roles",
  );
});
test("management permission is not duplicated and generated configs are independent", () => {
  const first = createAuthSections([
    { value: "users:manage", label: "Manage" },
  ]);
  first[1].defaults.email = "changed@example.com";
  assert.equal(
    first[0].formFields.find((field) => field.field === "permissions").items
      .length,
    1,
  );
  assert.equal(createAuthSections([])[1].defaults.email, "");
});
