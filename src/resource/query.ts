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
  const scalar = z.union([
    z.string().max(1000),
    z.number().finite(),
    z.boolean(),
    z.null(),
  ]);
  const parsed = parse(
    z.record(
      z.string(),
      z.union([
        scalar,
        z
          .object({
            eq: scalar.optional(),
            in: z
              .array(z.union([z.string(), z.number().finite(), z.boolean()]))
              .min(1)
              .max(100)
              .optional(),
            contains: z.string().max(1000).optional(),
            gt: z.union([z.string(), z.number()]).optional(),
            gte: z.union([z.string(), z.number()]).optional(),
            lt: z.union([z.string(), z.number()]).optional(),
            lte: z.union([z.string(), z.number()]).optional(),
          })
          .strict()
          .refine((v) => Object.keys(v).length > 0),
      ]),
    ),
    filters,
  );
  let i = 0;
  for (const [field, value] of Object.entries(parsed)) {
    if (!["id", ...(definition.filterable ?? [])].includes(field))
      throw new BadRequestException(`Field is not filterable: ${field}`);
    const column = `r.${field}`;
    const operations =
      value !== null && typeof value === "object" ? value : { eq: value };
    for (const [op, operand] of Object.entries(operations)) {
      const param = `p${i++}`;
      if (op === "eq" && operand === null) qb.andWhere(`${column} IS NULL`);
      else if (op === "in")
        qb.andWhere(`${column} IN (:...${param})`, { [param]: operand });
      else if (op === "contains") {
        // Explicit ! escape works on both PostgreSQL and MySQL (no backslash mode assumptions).
        qb.andWhere(`${column} LIKE :${param} ESCAPE '!'`, {
          [param]: `%${String(operand).replace(/[!%_]/g, "!$&")}%`,
        });
      } else {
        const sqlOp = { eq: "=", gt: ">", gte: ">=", lt: "<", lte: "<=" }[op];
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
