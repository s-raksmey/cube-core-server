import { z } from "zod";
import { validationError } from "@/src/lib/errors";

export const searchSchema = z.string().trim().max(160).nullish()
  .transform((value) => value || undefined);
export const pageSchema = z.number().int().min(1).max(100000).nullish()
  .transform((value) => value ?? 1);
export const pageSizeSchema = z.number().int().min(1).max(100).nullish()
  .transform((value) => value ?? 25);
export const searchPageSchema = z.object({
  search: searchSchema,
  page: pageSchema,
  pageSize: pageSizeSchema,
});

export function parseSearchPage(input: unknown = {}) {
  const parsed = searchPageSchema.safeParse(input);
  if (!parsed.success) throw validationError(parsed.error.issues[0]?.message ?? "Invalid search input");
  return parsed.data;
}

export function pageOffset(page: number, pageSize: number) {
  return (page - 1) * pageSize;
}
