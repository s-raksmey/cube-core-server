import { ArticleStatus, Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/src/lib/db";
import { validationError } from "@/src/lib/errors";
import { findActiveTenantById } from "@/src/modules/tenants/tenant-domain.service";

const slugSchema = z.string().trim().toLowerCase().max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const filterSchema = z.object({
  categorySlug: slugSchema.nullish(), subcategorySlug: slugSchema.nullish(), tagSlug: slugSchema.nullish(),
  search: z.string().trim().max(160).nullish(),
  featured: z.boolean().nullish(), breaking: z.boolean().nullish(),
  page: z.number().int().min(1).max(100000).default(1),
  pageSize: z.number().int().min(1).max(30).default(12),
});

const categorySelect = {
  uuid: true, slug: true, name: true,
  translations: { select: { locale: true, name: true }, orderBy: { locale: "asc" } },
} satisfies Prisma.CategorySelect;

const navigationCategorySelect = {
  ...categorySelect,
  subcategories: {
    select: { slug: true, translations: { select: { locale: true, name: true }, orderBy: { locale: "asc" } } },
    orderBy: { slug: "asc" } },
} satisfies Prisma.CategorySelect;

const summarySelect = {
  uuid: true, title: true, slug: true, summary: true,
  isBreaking: true, isFeatured: true, featuredImageUrl: true, publishedAt: true,
  category: { select: categorySelect },
  subcategory: { select: { slug: true } },
  translations: { select: { locale: true, title: true, summary: true }, orderBy: { locale: "asc" } },
} satisfies Prisma.ArticleSelect;

const detailSelect = {
  ...summarySelect,
  content: true,
  createdBy: { select: { firstName: true, lastName: true } },
  translations: { select: { locale: true, title: true, summary: true, content: true }, orderBy: { locale: "asc" } },
  tags: { select: { tag: { select: { slug: true, name: true,
    translations: { select: { locale: true, name: true }, orderBy: { locale: "asc" } },
  } } }, orderBy: { tagUuid: "asc" } },
} satisfies Prisma.ArticleSelect;

type Summary = Prisma.ArticleGetPayload<{ select: typeof summarySelect }>;
type Detail = Prisma.ArticleGetPayload<{ select: typeof detailSelect }>;

function mapSummary(row: Summary) {
  return {
    id: row.uuid, title: row.title, slug: row.slug, summary: row.summary,
    category: { id: row.category.uuid, slug: row.category.slug, name: row.category.name, translations: row.category.translations },
    subcategorySlug: row.subcategory.slug,
    isBreaking: row.isBreaking, isFeatured: row.isFeatured,
    featuredImageUrl: row.featuredImageUrl, publishedAt: row.publishedAt!.toISOString(),
    translations: row.translations,
  };
}

function mapDetail(row: Detail) {
  return {
    ...mapSummary(row), content: row.content,
    authorName: row.createdBy ? `${row.createdBy.firstName} ${row.createdBy.lastName}`.trim() : null,
    translations: row.translations,
    tags: row.tags.map(({ tag }) => ({ slug: tag.slug, name: tag.name, translations: tag.translations })),
  };
}

async function activeTenant(tenantId: string) {
  if (!z.string().uuid().safeParse(tenantId).success) throw validationError("Invalid tenant ID");
  return findActiveTenantById(tenantId);
}

export async function publicWebsiteCategories(tenantId: string) {
  const tenant = await activeTenant(tenantId);
  if (!tenant) return [];
  const rows = await prisma.category.findMany({
    where: { tenantUuid: tenant.uuid },
    select: navigationCategorySelect, orderBy: { name: "asc" }, take: 100,
  });
  return rows.map((row) => ({ id: row.uuid, slug: row.slug, name: row.name,
    translations: row.translations, subcategories: row.subcategories }));
}

export async function publicWebsiteTags(tenantId: string) {
  const tenant = await activeTenant(tenantId);
  if (!tenant) return [];
  const rows = await prisma.tag.findMany({
    where: { tenantUuid: tenant.uuid, articles: { some: { article: {
      status: ArticleStatus.PUBLISHED, publishedAt: { lte: new Date() },
    } } } },
    select: { slug: true, name: true,
      translations: { select: { locale: true, name: true }, orderBy: { locale: "asc" } },
    },
    orderBy: { name: "asc" }, take: 200,
  });
  return rows;
}

export async function publicWebsiteArticles(tenantId: string, input: unknown) {
  const parsed = filterSchema.safeParse(input);
  if (!parsed.success) throw validationError(parsed.error.issues[0]?.message ?? "Invalid article filter");
  const { page, pageSize, categorySlug, subcategorySlug, tagSlug, search, featured, breaking } = parsed.data;
  const tenant = await activeTenant(tenantId);
  if (!tenant) return { items: [], total: 0, page, pageSize };
  const where: Prisma.ArticleWhereInput = {
    tenantUuid: tenant.uuid, status: ArticleStatus.PUBLISHED, publishedAt: { lte: new Date() },
    ...(categorySlug ? { category: { slug: categorySlug } } : {}),
    ...(subcategorySlug ? { subcategory: { slug: subcategorySlug } } : {}),
    ...(tagSlug ? { tags: { some: { tag: { slug: tagSlug } } } } : {}),
    ...(featured === true ? { isFeatured: true } : {}),
    ...(breaking === true ? { isBreaking: true } : {}),
    ...(search ? { OR: [
      { title: { contains: search, mode: "insensitive" } },
      { summary: { contains: search, mode: "insensitive" } },
      { translations: { some: { title: { contains: search, mode: "insensitive" } } } },
    ] } : {}),
  };
  const [items, total] = await prisma.$transaction([
    prisma.article.findMany({ where, select: summarySelect,
      orderBy: [{ publishedAt: "desc" }, { uuid: "desc" }], skip: (page - 1) * pageSize, take: pageSize }),
    prisma.article.count({ where }),
  ]);
  return { items: items.map(mapSummary), total, page, pageSize };
}

export async function publicWebsiteArticle(tenantId: string, slug: string) {
  const parsed = slugSchema.safeParse(slug);
  if (!parsed.success) return null;
  const tenant = await activeTenant(tenantId);
  if (!tenant) return null;
  const row = await prisma.article.findFirst({
    where: { tenantUuid: tenant.uuid, slug: parsed.data, status: ArticleStatus.PUBLISHED,
      publishedAt: { lte: new Date() } },
    select: detailSelect,
  });
  return row ? mapDetail(row) : null;
}
