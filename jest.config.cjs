module.exports = {
  preset: "ts-jest",
  watchman: false,
  testEnvironment: "node",
  testMatch: ["<rootDir>/test/**/*.spec.ts"],
  testPathIgnorePatterns: ["integration"],
  clearMocks: true,
};
