import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadResources } from "../src/resource/resource.loader";

let directory: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "cms-resources-"));
});
afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});
function resource(file: string, name: string) {
  writeFileSync(
    join(directory, file),
    `const { z } = require(${JSON.stringify(require.resolve("zod"))});
exports.default = { name: ${JSON.stringify(name)}, schema: z.object({ title: z.string() }), columns: { title: { type: String } } };`,
  );
}
it("discovers source resources without an index", () => {
  expect(
    loadResources(join(__dirname, "../resources")).map((r) => r.name),
  ).toEqual(["articles", "categories"]);
});
it("picks up a newly added file, sorts definitions and stops loading removed files", () => {
  resource("zebra.js", "zebras");
  expect(loadResources(directory, ".js").map((r) => r.name)).toEqual([
    "zebras",
  ]);
  resource("apple.js", "apples");
  expect(loadResources(directory, ".js").map((r) => r.name)).toEqual([
    "apples",
    "zebras",
  ]);
  rmSync(join(directory, "zebra.js"));
  expect(loadResources(directory, ".js").map((r) => r.name)).toEqual([
    "apples",
  ]);
});
it("ignores helpers, tests, declarations and the other runtime extension", () => {
  resource("articles.js", "articles");
  for (const file of [
    "_hooks.js",
    ".hidden.js",
    "bad.spec.js",
    "bad.test.js",
    "bad.d.js",
    "articles.ts",
    "articles.d.ts",
  ]) {
    writeFileSync(join(directory, file), 'throw new Error("Should not load")');
  }
  expect(loadResources(directory, ".js")).toHaveLength(1);
});
it("fails with the filename on invalid exports or module execution errors", () => {
  for (const code of [
    "module.exports = {};",
    'throw new Error("Broken import")',
  ]) {
    const filename = `${Math.random()}.js`;
    writeFileSync(join(directory, filename), code);
    expect(() => loadResources(directory, ".js")).toThrow(
      join(directory, filename),
    );
    rmSync(join(directory, filename));
  }
});
it("rejects duplicate resource names", () => {
  resource("a.js", "articles");
  resource("b.js", "articles");
  try {
    loadResources(directory, ".js");
    throw new Error("Expected loader failure");
  } catch (error) {
    expect((error as Error).message).toContain("b.js");
    expect(((error as Error).cause as Error).message).toContain(
      "Duplicate resource name",
    );
  }
});
