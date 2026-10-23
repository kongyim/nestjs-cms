import { ConflictException, ForbiddenException } from "@nestjs/common";
import type {
  ResourceRegistry,
  ResourceDefinition,
  HookAction,
} from "@nestjs-cms/core";
import { DataSource, EntityManager } from "typeorm";
import { ImportOptions, validateOptions } from "./options";
import { GoogleSheetReader, SheetReader } from "./sheets";
import { planImport, orderRows, ImportRow } from "./plan";

export interface ImportResult {
  dryRun: boolean;
  total: number;
  resources: Record<string, { created: number; updated: number }>;
  skippedSheets: string[];
}

export class DatabaseImporter {
  private running = false;
  constructor(
    private readonly db: DataSource,
    private readonly registry: ResourceRegistry,
    private readonly options: ImportOptions,
    private readonly reader: SheetReader = new GoogleSheetReader(),
  ) {}

  async run(
    settings: {
      dryRun?: boolean;
      canWrite?: (resource: string) => boolean;
    } = {},
  ): Promise<ImportResult> {
    if (this.running)
      throw new ConflictException("A database import is already running.");
    this.running = true;
    try {
      validateOptions(this.options);
      const names = this.options.resources?.length
        ? [...new Set(this.options.resources)]
        : this.registry.describe().map((resource) => resource.name);
      for (const name of names) this.registry.get(name);
      const sheets = await this.reader.read(this.options, names);
      // Filter even custom readers to the server-configured allowlist.
      const selected = Object.fromEntries(
        names
          .filter((name) => Object.hasOwn(sheets, name))
          .map((name) => [name, sheets[name]]),
      );
      for (const name of Object.keys(selected)) {
        if (settings.canWrite && !settings.canWrite(name))
          throw new ForbiddenException(`No write permission for ${name}.`);
      }
      const rows = orderRows(
        planImport(
          selected,
          this.registry,
          this.options.spreadsheetId,
          this.options.maxRows,
        ),
      );
      const result: ImportResult = {
        dryRun: settings.dryRun ?? false,
        total: rows.length,
        resources: {},
        skippedSheets: names.filter((name) => !Object.hasOwn(selected, name)),
      };
      await this.db.transaction("SERIALIZABLE", async (manager) => {
        // Database-wide lock also serializes imports started by a separate CLI/process.
        // Postgres releases transaction advisory locks automatically; MySQL uses connection locks below.
        const mysql =
          this.db.options.type === "mysql" ||
          this.db.options.type === "mariadb";
        if (this.db.options.type === "postgres") {
          const lock = await manager.query(
            "SELECT pg_try_advisory_xact_lock(1876309412) AS acquired",
          );
          if (!lock[0].acquired)
            throw new ConflictException(
              "A database import is already running.",
            );
        } else if (mysql) {
          const lock = await manager.query(
            "SELECT GET_LOCK('nestjs-cms-import', 0) AS acquired",
          );
          if (Number(lock[0].acquired) !== 1)
            throw new ConflictException(
              "A database import is already running.",
            );
        }
        try {
          const plannedIds = new Set(rows.map((row) => row.id));
          const prepared: {
            row: ImportRow;
            previous?: Record<string, unknown>;
            data: Record<string, unknown>;
          }[] = [];
          // Validate the entire sheet before invoking hooks or writing any rows.
          for (const row of rows) {
            const def = this.registry.get(row.resource);
            for (const ref of row.references) {
              if (
                !plannedIds.has(ref.id) &&
                !(await manager
                  .getRepository(ref.resource)
                  .existsBy({ id: ref.id }))
              )
                throw new Error(
                  `${row.resource} row ${row.row}: missing reference ${ref.resource}.${ref.key}. Include that resource or import it first.`,
                );
            }
            const previous =
              (await manager
                .getRepository(row.resource)
                .findOneBy({ id: row.id })) ?? undefined;
            let patch = row.data;
            if (previous) {
              const update = (
                def.updateSchema ?? def.schema.partial().strict()
              ).safeParse(row.data);
              if (!update.success)
                throw new Error(
                  `${row.resource} row ${row.row}: invalid update fields.`,
                );
              patch = Object.fromEntries(
                Object.entries(update.data as Record<string, unknown>).filter(
                  ([key]) => Object.hasOwn(row.data, key),
                ),
              );
            }
            const stored = previous
              ? Object.fromEntries(
                  Object.keys(def.columns).map((key) => [key, previous[key]]),
                )
              : {};
            const parsed = def.schema
              .strict()
              .safeParse({ ...stored, ...patch });
            if (!parsed.success)
              throw new Error(
                `${row.resource} row ${row.row}: ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`,
              );
            prepared.push({ row, previous, data: parsed.data });
          }
          for (const { row, previous, data } of prepared) {
            const def = this.registry.get(row.resource);
            const action = previous ? "updated" : "created";
            const counts = (result.resources[row.resource] ??= {
              created: 0,
              updated: 0,
            });
            counts[action]++;
            if (result.dryRun) continue;
            try {
              const modified = await this.hooks(
                def,
                previous ? "onBeforeUpdate" : "onBeforeCreate",
                manager,
                row.id,
                data,
                previous,
              );
              const checked = def.schema.strict().parse(modified);
              if (previous)
                await manager
                  .getRepository(row.resource)
                  .update({ id: row.id }, checked);
              else
                await manager
                  .getRepository(row.resource)
                  .insert({ ...checked, id: row.id });
              const saved = await manager
                .getRepository(row.resource)
                .findOneByOrFail({ id: row.id });
              await this.hooks(
                def,
                previous ? "onAfterUpdate" : "onAfterCreate",
                manager,
                row.id,
                saved,
                previous,
              );
            } catch {
              throw new Error(
                `${row.resource} row ${row.row}: could not save record. Check unique fields, foreign keys, and resource hooks. No rows were imported.`,
              );
            }
          }
        } finally {
          if (mysql)
            await manager.query("SELECT RELEASE_LOCK('nestjs-cms-import')");
        }
      });
      return result;
    } finally {
      this.running = false;
    }
  }

  private async hooks(
    def: ResourceDefinition,
    action: HookAction,
    manager: EntityManager,
    id: string,
    record: Record<string, unknown>,
    previous?: Record<string, unknown>,
  ) {
    let current = structuredClone(record);
    for (const hook of def.hooks?.[action] ?? []) {
      const changed = await hook({
        manager,
        resource: def.name,
        action,
        id,
        record: current,
        previous: previous && structuredClone(previous),
      });
      if (action.startsWith("onBefore") && changed) current = changed;
    }
    return current;
  }
}
