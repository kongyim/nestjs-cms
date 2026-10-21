import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableForeignKey,
  TableIndex,
} from "typeorm";
export class InitialCms1792540800000 implements MigrationInterface {
  async up(runner: QueryRunner) {
    const postgres = runner.connection.options.type === "postgres";
    const timestamp = postgres ? "timestamp" : "datetime";
    const generatedDate = postgres
      ? { type: timestamp, default: "now()" }
      : { type: timestamp, precision: 6, default: "CURRENT_TIMESTAMP(6)" };
    const base = () => [
      { name: "id", type: "varchar", length: "36", isPrimary: true },
      { name: "createdAt", ...generatedDate },
      {
        name: "updatedAt",
        ...generatedDate,
        ...(postgres ? {} : { onUpdate: "CURRENT_TIMESTAMP(6)" }),
      },
    ];
    await runner.createTable(
      new Table({
        name: "categories",
        columns: [
          ...base(),
          { name: "slug", type: "varchar", length: "120", isUnique: postgres },
          { name: "name", type: "json" },
          { name: "status", type: "varchar", length: "20" },
        ],
      }),
    );
    await runner.createTable(
      new Table({
        name: "articles",
        columns: [
          ...base(),
          { name: "title", type: "varchar", length: "200" },
          { name: "slug", type: "varchar", length: "120", isUnique: postgres },
          { name: "body", type: "text" },
          { name: "status", type: "varchar", length: "20" },
          {
            name: "categoryId",
            type: "varchar",
            length: "36",
            isNullable: true,
          },
        ],
      }),
    );
    if (!postgres) {
      for (const table of ["categories", "articles"]) {
        await runner.createIndex(
          table,
          new TableIndex({ columnNames: ["slug"], isUnique: true }),
        );
      }
    }
    await runner.createForeignKey(
      "articles",
      new TableForeignKey({
        columnNames: ["categoryId"],
        referencedTableName: "categories",
        referencedColumnNames: ["id"],
        onDelete: "RESTRICT",
      }),
    );
    await runner.createTable(
      new Table({
        name: "cms_attachments",
        columns: [
          { name: "id", type: "varchar", length: "36", isPrimary: true },
          { name: "resource", type: "varchar", length: "100" },
          { name: "recordId", type: "varchar", length: "36" },
          { name: "field", type: "varchar", length: "100" },
          { name: "name", type: "varchar", length: "255" },
          { name: "mimeType", type: "varchar", length: "120" },
          { name: "size", type: "int" },
          { name: "stagingKey", type: "varchar", length: "512" },
          { name: "key", type: "varchar", length: "512" },
          { name: "status", type: "varchar", length: "10" },
          { name: "expiresAt", type: timestamp },
          { name: "createdAt", ...generatedDate },
        ],
      }),
    );
    await runner.createIndex(
      "cms_attachments",
      new TableIndex({ columnNames: ["resource", "recordId", "status"] }),
    );
    await runner.createIndex(
      "cms_attachments",
      new TableIndex({ columnNames: ["status", "expiresAt"] }),
    );
  }
  async down(runner: QueryRunner) {
    await runner.dropTable("cms_attachments");
    await runner.dropTable("articles");
    await runner.dropTable("categories");
  }
}
