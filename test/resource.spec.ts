import { ResourceRegistry } from "../src/resource/resource.registry";
import { readConfig } from "../src/config";
import { parse } from "../src/resource/validation";
import articles from "../resources/articles";
import { applyQuery } from "../src/resource/query";
import { SelectQueryBuilder } from "typeorm";

describe("definition and configuration contracts", () => {
  it("exposes JSON schemas and attachment declarations", () => {
    const registry = new ResourceRegistry();
    const article = registry.describe().find((d) => d.name === "articles")!;
    expect(article.schema.required).toContain("title");
    expect(article.attachments.map((f) => f.field)).toEqual(["cover", "files"]);
    expect(() => registry.get("__proto__")).toThrow("Resource not found");
  });
  it("rejects unknown and system fields and invalid payloads", () => {
    expect(() =>
      parse(articles.schema.strict(), { title: "", slug: "a" }),
    ).toThrow();
    expect(() =>
      parse(articles.schema.strict(), { title: "a", slug: "a", id: "owned" }),
    ).toThrow();
    expect(() =>
      parse(articles.schema.strict(), { title: "a", slug: "a", cover: {} }),
    ).toThrow();
  });
  it("requires safe production settings and paired S3 credentials", () => {
    expect(() =>
      readConfig({ NODE_ENV: "production", DB_SYNCHRONIZE: "true" }),
    ).toThrow("DB_SYNCHRONIZE");
    expect(() => readConfig({ NODE_ENV: "production" })).toThrow(
      "ADMIN_API_KEY",
    );
    expect(() => readConfig({ S3_ACCESS_KEY_ID: "key" })).toThrow(
      "both S3 credentials",
    );
    expect(readConfig({ DB_TYPE: "mysql" }).DB_TYPE).toBe("mysql");
  });
  it("rejects unbounded pagination, raw SQL fields, malformed filters and sort", () => {
    const qb = {} as SelectQueryBuilder<Record<string, unknown>>;
    for (const query of [
      { limit: "all" },
      { page: "1.5" },
      { query: "{" },
      { query: "[]" },
      { query: '{"body": "x"}' },
      { query: '{"slug":{"raw":"1=1"}}' },
      { sort: "slug;DROP TABLE articles" },
    ]) {
      expect(() => applyQuery(qb, articles, query)).toThrow();
    }
  });
});
