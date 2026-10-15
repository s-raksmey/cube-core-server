import { z } from "zod";

const slug = z.string().trim().toLowerCase().min(1).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const markdown = z.string().max(100_000).refine(
  (content) => !/<\s*\/?\s*[a-z!][^>]*>/i.test(content),
  "Raw HTML is not supported in article content",
);
const featuredImageUrl = z.string().trim().url().max(2048).refine(
  (value) => new URL(value).protocol === "https:",
  "Featured image URL must use HTTPS",
);
export const articleTranslationSchema = z.object({
  locale: z.string().trim().toLowerCase().regex(/^[a-z]{2,8}(?:-[a-z0-9]{2,8})?$/)
    .refine((value) => value !== "en", "English is the default article language"),
  title: z.string().trim().min(1).max(240),
  summary: z.string().trim().max(500).nullish(),
  content: markdown,
});
const translations = z.array(articleTranslationSchema).max(50).superRefine((items, ctx) => {
  if (new Set(items.map((item) => item.locale)).size !== items.length) {
    ctx.addIssue({ code: "custom", message: "Translation locales must be unique" });
  }
});
export const createArticleSchema = z.object({
  title: z.string().trim().min(1).max(240),
  slug,
  summary: z.string().trim().max(500).nullish(),
  content: markdown,
  categoryId: z.string().uuid(),
  subcategoryId: z.string().uuid(),
  tagIds: z.array(z.string().uuid()).max(50).default([]).superRefine((items, ctx) => {
    if (new Set(items).size !== items.length) ctx.addIssue({ code: "custom", message: "Tags must be unique" });
  }),
  translations: translations.default([]),
  featuredImageUrl: featuredImageUrl.nullish(),
  isBreaking: z.boolean().optional(),
  isFeatured: z.boolean().optional(),
});
export const updateArticleSchema = createArticleSchema.omit({ tagIds: true, translations: true }).partial().extend({
  tagIds: createArticleSchema.shape.tagIds.removeDefault().optional(),
  translations: translations.optional(),
});
export const scheduleAtSchema = z.string().datetime({ offset: true });
export const commentSchema = z.string().trim().min(1).max(2000);
