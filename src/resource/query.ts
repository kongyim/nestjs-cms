import { BadRequestException } from "@nestjs/common";
import { SelectQueryBuilder, ObjectLiteral } from "typeorm";
import { z } from "zod";
import { parse } from "./validation";
import { ResourceDefinition } from "./resource.types";
export const listSchema = z
  .object({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    limit: z.coerce.number().int().min(1).max(150).default(25),
    query: z.string().max(8192).optional(),
    sort: z.string().max(100).optional(),
  })
  .strict();
const comparisonSql = {
  $eq: "=",
  $gt: ">",
  $gte: ">=",
  $lt: "<",
  $lte: "<=",
} as const;
const scalar = z.union([
  z.string().max(1000),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);
const orderedScalar = z.union([z.string().max(1000), z.number().finite()]);
const position = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const locateSchema = z.union([
  z.string().min(1).max(1000),
  z
    .object({
      search: z.string().min(1).max(1000),
      $eq: position.optional(),
      $gt: position.optional(),
      $gte: position.optional(),
      $lt: position.optional(),
      $lte: position.optional(),
    })
    .strict(),
]);
const filtersSchema = z.record(
  z.string(),
  z.union([
    scalar,
    z
      .object({
        $eq: scalar.optional(),
        $in: z
          .array(
            z.union([z.string().max(1000), z.number().finite(), z.boolean()]),
          )
          .min(1)
          .max(100)
          .optional(),
        $contains: z.string().max(1000).optional(),
        $gt: orderedScalar.optional(),
        $gte: orderedScalar.optional(),
        $lt: orderedScalar.optional(),
        $lte: orderedScalar.optional(),
        $locate: locateSchema.optional(),
      })
      .strict()
      .refine((value) => Object.keys(value).length > 0),
  ]),
);

export function applyQuery(
  qb: SelectQueryBuilder<ObjectLiteral>,
  definition: ResourceDefinition,
  raw: unknown,
) {
  const input = parse(listSchema, raw);
  let filters: unknown = {};
  try {
    filters = input.query ? JSON.parse(input.query) : {};
  } catch {
    throw new BadRequestException("query must be a JSON object");
  }
  const parsed = parse(filtersSchema, filters);
  let i = 0;
  for (const [field, value] of Object.entries(parsed)) {
    if (!["id", ...(definition.filterable ?? [])].includes(field))
      throw new BadRequestException(`Field is not filterable: ${field}`);
    const column = `r.${field}`;
    const operations =
      value !== null && typeof value === "object" ? value : { $eq: value };
    for (const [op, operand] of Object.entries(operations)) {
      const param = `p${i++}`;
      if (op === "$eq" && operand === null) qb.andWhere(`${column} IS NULL`);
      else if (op === "$in")
        qb.andWhere(`${column} IN (:...${param})`, { [param]: operand });
      else if (op === "$contains") {
        // Explicit ! escape works on both PostgreSQL and MySQL (no backslash mode assumptions).
        qb.andWhere(`${column} LIKE :${param} ESCAPE '!'`, {
          [param]: `%${String(operand).replace(/[!%_]/g, "!$&")}%`,
        });
      } else if (op === "$locate") {
        const type = definition.columns[field]?.type;
        if (
          field !== "id" &&
          type !== String &&
          ![
            "varchar",
            "char",
            "text",
            "tinytext",
            "mediumtext",
            "longtext",
          ].includes(String(type))
        ) {
          throw new BadRequestException("$locate requires a string column");
        }
        const locate = parse(locateSchema, operand);
        const search = typeof locate === "string" ? locate : locate.search;
        const driver = qb.connection.options.type;
        if (driver !== "postgres" && driver !== "mysql")
          throw new BadRequestException("$locate requires PostgreSQL or MySQL");
        const expression =
          driver === "postgres"
            ? `STRPOS(${column}, :${param})`
            : `LOCATE(:${param}, ${column})`;
        const comparisons =
          typeof locate === "string" || Object.keys(locate).length === 1
            ? { $gt: 0 }
            : locate;
        for (const [comparison, bound] of Object.entries(comparisons)) {
          if (comparison === "search") continue;
          const positionParam = `p${i++}`;
          const sqlOp = comparisonSql[comparison as keyof typeof comparisonSql];
          qb.andWhere(`${expression} ${sqlOp} :${positionParam}`, {
            [param]: search,
            [positionParam]: bound,
          });
        }
      } else {
        const sqlOp = comparisonSql[op as keyof typeof comparisonSql];
        if (!sqlOp) throw new BadRequestException("Unsupported operator");
        qb.andWhere(`${column} ${sqlOp} :${param}`, { [param]: operand });
      }
    }
  }
  const [field, direction = "asc", extra] = (
    input.sort ?? "createdAt:desc"
  ).split(":");
  if (
    extra ||
    !["asc", "desc"].includes(direction) ||
    !["id", "createdAt", ...(definition.sortable ?? [])].includes(field)
  )
    throw new BadRequestException("Invalid sort; use field:asc or field:desc");
  qb.orderBy(`r.${field}`, direction.toUpperCase() as "ASC" | "DESC");
  if (field !== "id") qb.addOrderBy("r.id", "ASC");
  qb.skip((input.page - 1) * input.limit).take(input.limit);
  return input;
}
