import { BadRequestException } from "@nestjs/common";
import { z } from "zod";
export function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success)
    throw new BadRequestException({
      message: "Validation failed",
      issues: result.error.issues,
    });
  return result.data;
}
export function recordId(id: string) {
  return parse(z.uuid(), id);
}
