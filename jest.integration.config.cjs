process.env.NODE_ENV = "test";
process.env.DB_DATABASE = "cms_test";
process.env.DB_SYNCHRONIZE = "false";
process.env.ADMIN_API_KEY = "integration-test-api-key";
module.exports = {
  preset: "ts-jest",
  watchman: false,
  testEnvironment: "node",
  testMatch: ["**/test/**/*.integration.ts"],
  testTimeout: 60000,
};
