module.exports = {
  preset: "ts-jest",
  watchman: false,
  testEnvironment: "node",
  testMatch: ["**/test/**/*.spec.ts"],
  transform: { "^.+\\.tsx?$": ["ts-jest", { tsconfig: { rootDir: "." } }] },
};
