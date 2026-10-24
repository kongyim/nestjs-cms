#!/usr/bin/env node
import "reflect-metadata";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { createAuthDataSource, CmsAuthOptions } from "@nestjs-cms/auth";
import { ResourceRegistry } from "@nestjs-cms/core";
import { DatabaseImporter } from "./importer";
import { importOptionsFromEnv } from "./options";

export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({
    args,
    options: {
      config: { type: "string" },
      "base-dir": { type: "string" },
      "dry-run": { type: "boolean", default: false },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: false,
  });
  if (values.help) {
    console.log("Usage: nestjs-cms-import --config <auth.config.ts|js> [--base-dir <directory>] [--dry-run]");
    return;
  }
  if (!values.config) throw new Error("--config is required. Export authConfig from the configuration file.");
  const configPath = resolve(values.config);
  const appRequire = createRequire(configPath);
  if (configPath.endsWith(".ts")) {
    let tsNode: { register(options: { cwd: string }): unknown };
    try {
      tsNode = appRequire("ts-node");
    } catch {
      throw new Error("Loading TypeScript configuration requires ts-node and typescript in your application. Alternatively, pass compiled JavaScript.");
    }
    tsNode.register({ cwd: dirname(configPath) });
  }
  const { authConfig } = appRequire(configPath) as { authConfig?: CmsAuthOptions };
  if (!authConfig || typeof authConfig !== "object" || Array.isArray(authConfig))
    throw new Error("The configuration file must export an authConfig object.");
  const { dataSource, resources } = createAuthDataSource(authConfig);
  dataSource.setOptions({ synchronize: false });
  await dataSource.initialize();
  try {
    const importer = new DatabaseImporter(
      dataSource,
      new ResourceRegistry(resources),
      importOptionsFromEnv(process.env, resolve(values["base-dir"] ?? ".")),
    );
    const result = await importer.run({ dryRun: values["dry-run"] });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await dataSource.destroy();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Database import failed.");
    process.exitCode = 1;
  });
}
