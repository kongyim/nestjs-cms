import { resolve } from "node:path";

export interface ImportOptions {
  keyFile: string;
  spreadsheetId: string;
  /** Omitted/empty means every registered resource with a matching tab. */
  resources?: string[];
  maxRows?: number;
}

export function importOptionsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  baseDirectory = process.cwd(),
): ImportOptions {
  return {
    keyFile: env.GSHEET_KEY_PATH
      ? resolve(baseDirectory, env.GSHEET_KEY_PATH)
      : "",
    spreadsheetId: env.GSHEET_ID ?? "",
    resources: env.GSHEET_IMPORT_RESOURCES?.split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  };
}

export function validateOptions(options: ImportOptions) {
  if (!options.keyFile || !/^[\w-]+$/.test(options.spreadsheetId))
    throw new Error(
      "Configure GSHEET_KEY_PATH and GSHEET_ID before importing.",
    );
  if (options.resources?.some((name) => !/^[a-z][a-z0-9_]*$/.test(name)))
    throw new Error(
      "GSHEET_IMPORT_RESOURCES must contain comma-separated resource names.",
    );
  if (
    options.maxRows !== undefined &&
    (!Number.isSafeInteger(options.maxRows) || options.maxRows < 1)
  )
    throw new Error("maxRows must be a positive integer.");
}
