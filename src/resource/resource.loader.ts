import { readdirSync } from "node:fs";
import { extname, join } from "node:path";
import { z } from "zod";
import type { ResourceDefinition } from "./resource.types";

// The consuming application chooses the resource directory.
export function loadResources(
  directory: string,
  extension = extname(__filename),
): ResourceDefinition[] {
  const files = readdirSync(directory, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith(extension) &&
        !entry.name.startsWith("_") &&
        !entry.name.startsWith(".") &&
        !/\.(d|spec|test)\.[cm]?[jt]s$/.test(entry.name),
    )
    .map((entry) => entry.name)
    .sort();

  const names = new Set<string>();
  return files.map((file) => {
    const path = join(directory, file);
    let definition: ResourceDefinition;
    try {
      definition = require(path).default;
      if (
        !definition ||
        typeof definition.name !== "string" ||
        !/^[a-z][a-z0-9_]*$/.test(definition.name) ||
        !(definition.schema instanceof z.ZodObject) ||
        !definition.columns ||
        typeof definition.columns !== "object" ||
        Array.isArray(definition.columns)
      ) {
        throw new Error(
          "Expected a default-exported resource with name, Zod object schema and columns",
        );
      }
      if (names.has(definition.name)) {
        throw new Error(`Duplicate resource name: ${definition.name}`);
      }
      names.add(definition.name);
    } catch (cause) {
      throw new Error(`Failed to load resource ${path}`, { cause });
    }
    return definition;
  });
}
