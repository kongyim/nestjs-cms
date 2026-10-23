const { test } = require("node:test");
const assert = require("node:assert/strict");
const { ResourceRegistry, z } = require("@nestjs-cms/core");
const {
  planImport,
  orderRows,
  importRecordId,
  importOptionsFromEnv,
  DatabaseImporter,
} = require("../dist");
const defs = [
  {
    name: "categories",
    schema: z.object({ name: z.string() }).strict(),
    columns: { name: { type: String } },
  },
  {
    name: "pages",
    schema: z
      .object({
        title: z.string(),
        categoryId: z.string().uuid().nullable().default(null),
        featured: z.boolean().default(false),
        rating: z.number().max(5).default(0),
        tags: z.array(z.string()).default([]),
      })
      .strict(),
    columns: {
      title: { type: String },
      categoryId: { type: String, nullable: true },
      featured: { type: Boolean },
      rating: { type: Number },
      tags: { type: "json" },
    },
    foreignKeys: [
      {
        target: "categories",
        columnNames: ["categoryId"],
        referencedColumnNames: ["id"],
      },
    ],
  },
];
const registry = new ResourceRegistry(defs);
const sheets = {
  pages: [
    ["_key", "title", "categoryId@categories", "featured", "rating", "tags"],
    ["welcome", "Welcome", "news", "TRUE", "4", '["news"]'],
  ],
  categories: [
    ["_key", "name"],
    ["news", "News"],
  ],
};
test("stable UUIDs, typed cells, reference resolution and dependency ordering", () => {
  const rows = orderRows(planImport(sheets, registry, "sheet"));
  assert.equal(rows[0].resource, "categories");
  assert.equal(rows[1].data.categoryId, rows[0].id);
  assert.equal(rows[1].data.featured, true);
  assert.equal(rows[1].data.rating, 4);
  assert.deepEqual(rows[1].data.tags, ["news"]);
  assert.equal(rows[0].id, importRecordId("sheet", "categories", "news"));
  assert.match(
    rows[0].id,
    /^[\da-f]{8}-[\da-f]{4}-5[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/,
  );
  assert.notEqual(
    rows[0].id,
    importRecordId("other-sheet", "categories", "news"),
  );
});
test("rejects missing keys, duplicate keys/headers, invalid references and malformed cells", () => {
  for (const values of [
    [["title"], ["No key"]],
    [
      ["_key", "title"],
      ["same", "A"],
      ["same", "B"],
    ],
    [
      ["_key", "title", "title"],
      ["a", "A", "B"],
    ],
    [
      ["_key", "id"],
      ["a", "forbidden"],
    ],
    [
      ["_key", "title@categories"],
      ["a", "news"],
    ],
    [
      ["_key", "featured"],
      ["a", "not-boolean"],
    ],
    [
      ["_key", "tags"],
      ["a", "not-json"],
    ],
    [
      ["_key", ""],
      ["a", "hidden"],
    ],
  ])
    assert.throws(() => planImport({ pages: values }, registry, "sheet"));
  assert.throws(() => planImport(sheets, registry, "sheet", 1), /row limit/);
});
test("blank cells are omitted, explicit null clears a nullable field", () => {
  const [row] = planImport(
    {
      pages: [
        ["_key", "title", "categoryId@categories"],
        ["a", "", "null"],
      ],
    },
    registry,
    "sheet",
  );
  assert.deepEqual(row.data, { categoryId: null });
});
test("cycles fail explicitly", () => {
  const rows = planImport(sheets, registry, "sheet");
  rows[0].references = [{ id: rows[1].id }];
  rows[1].references = [{ id: rows[0].id }];
  assert.throws(() => orderRows(rows), /Circular/);
});
test("environment options resolve relative key paths and optional resource limits", () => {
  const options = importOptionsFromEnv(
    {
      GSHEET_KEY_PATH: "key.json",
      GSHEET_ID: "sheet",
      GSHEET_IMPORT_RESOURCES: " pages, categories, ",
    },
    "/app",
  );
  assert.equal(options.keyFile, "/app/key.json");
  assert.deepEqual(options.resources, ["pages", "categories"]);
  assert.equal(importOptionsFromEnv({}).resources, undefined);
});
function memoryDb() {
  let stored = { categories: new Map(), pages: new Map() };
  const manager = {
    getRepository(name) {
      return {
        existsBy: async ({ id }) => stored[name].has(id),
        findOneBy: async ({ id }) => stored[name].get(id),
        findOneByOrFail: async ({ id }) => stored[name].get(id),
        insert: async (data) => {
          stored[name].set(data.id, structuredClone(data));
        },
        update: async ({ id }, data) =>
          stored[name].set(id, {
            ...stored[name].get(id),
            ...structuredClone(data),
          }),
      };
    },
  };
  return {
    options: { type: "test" },
    get stored() {
      return stored;
    },
    transaction: async (_isolation, run) => {
      const backup = structuredClone(stored);
      try {
        return await run(manager);
      } catch (error) {
        stored = backup;
        throw error;
      }
    },
  };
}
test("reimport updates rather than duplicates, missing cells preserve existing values, dry-run writes nothing", async () => {
  const db = memoryDb();
  const reader = { read: async () => structuredClone(sheets) };
  const importer = new DatabaseImporter(
    db,
    registry,
    { keyFile: "key.json", spreadsheetId: "sheet" },
    reader,
  );
  const preview = await importer.run({ dryRun: true });
  assert.equal(preview.total, 2);
  assert.equal(db.stored.pages.size, 0);
  const first = await importer.run();
  assert.equal(first.resources.pages.created, 1);
  reader.read = async () => ({
    pages: [
      ["_key", "title"],
      ["welcome", "Changed"],
    ],
  });
  const second = await importer.run();
  assert.equal(second.resources.pages.updated, 1);
  assert.equal(db.stored.pages.size, 1);
  const page = [...db.stored.pages.values()][0];
  assert.equal(page.title, "Changed");
  assert.equal(page.featured, true);
});
test("allowlist and write permissions are enforced; bad reference and validation leave database untouched", async () => {
  const db = memoryDb();
  const options = {
    keyFile: "key.json",
    spreadsheetId: "sheet",
    resources: ["pages"],
  };
  const importer = new DatabaseImporter(db, registry, options, {
    read: async () => structuredClone(sheets),
  });
  await assert.rejects(importer.run(), /missing reference/);
  assert.equal(db.stored.categories.size, 0);
  await assert.rejects(
    importer.run({ canWrite: () => false }),
    /No write permission/,
  );
  const invalid = structuredClone(sheets);
  invalid.pages[1][4] = 6;
  const all = new DatabaseImporter(
    db,
    registry,
    { ...options, resources: undefined },
    { read: async () => invalid },
  );
  await assert.rejects(all.run(), /rating/);
  assert.equal(db.stored.categories.size, 0);
});
test("database failures roll back earlier writes and do not expose SQL or data", async () => {
  const db = memoryDb();
  let calls = 0;
  const original = db.transaction;
  db.transaction = async (iso, run) =>
    original(iso, (manager) =>
      run({
        ...manager,
        getRepository(name) {
          const repo = manager.getRepository(name);
          return {
            ...repo,
            insert: async (data) => {
              if (++calls === 2) throw Error("sensitive SQL");
              return repo.insert(data);
            },
          };
        },
      }),
    );
  const importer = new DatabaseImporter(
    db,
    registry,
    { keyFile: "key", spreadsheetId: "sheet" },
    { read: async () => sheets },
  );
  await assert.rejects(
    importer.run(),
    (error) =>
      error.message.includes("No rows were imported") &&
      !error.message.includes("sensitive SQL"),
  );
  assert.equal(db.stored.categories.size, 0);
});

test("update schema transforms and hooks are preserved", async () => {
  const definition = {
    ...defs[0],
    updateSchema: z
      .object({ name: z.string().transform((value) => value.toUpperCase()) })
      .strict(),
    hooks: {
      onBeforeUpdate: [
        ({ record }) => ({ ...record, name: record.name + "!" }),
      ],
    },
  };
  const db = memoryDb();
  const importer = new DatabaseImporter(
    db,
    new ResourceRegistry([definition]),
    { keyFile: "key", spreadsheetId: "sheet" },
    {
      read: async () => ({
        categories: [
          ["_key", "name"],
          ["news", "News"],
        ],
      }),
    },
  );
  await importer.run();
  await importer.run();
  assert.equal([...db.stored.categories.values()][0].name, "NEWS!");
});
