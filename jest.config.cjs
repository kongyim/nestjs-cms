module.exports = {
  preset: "ts-jest",
  watchman: false,
  testEnvironment: "node",
  testMatch: ["**/test/**/*.spec.ts"],
  testPathIgnorePatterns: ["integration"],
  clearMocks: true,
};
