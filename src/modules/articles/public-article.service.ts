import { ArticleStatus, Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/src/lib/db";
import { validationError } from "@/src/lib/errors";
import { findActiveTenantById } from "@/src/modules/tenants/tenant-domain.service";

const slugSchema = z.string().trim().toLowerCase().max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const relatedLimitSchema = z.number().int().min(1).max(12);
const POPULAR_WINDOW_DAYS = 7;
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

export const publicArticleSummarySelect = {
  uuid: true, title: true, slug: true, summary: true,
  isBreaking: true, breakingExpiresAt: true, isFeatured: true, featuredImageUrl: true, publishedAt: true, viewCount: true, shareCount: true,
  category: { select: categorySelect },
  subcategory: { select: { slug: true,
    translations: { select: { locale: true, name: true }, orderBy: { locale: "asc" } } } },
  translations: { select: { locale: true, title: true, summary: true }, orderBy: { locale: "asc" } },
} satisfies Prisma.ArticleSelect;

const detailSelect = {
  ...publicArticleSummarySelect,
  content: true, shareCount: true,
  createdBy: { select: { firstName: true, lastName: true } },
  translations: { select: { locale: true, title: true, summary: true, content: true }, orderBy: { locale: "asc" } },
  tags: { select: { tag: { select: { slug: true, name: true,
    translations: { select: { locale: true, name: true }, orderBy: { locale: "asc" } },
  } } }, orderBy: { tagUuid: "asc" } },
} satisfies Prisma.ArticleSelect;

type Summary = Prisma.ArticleGetPayload<{ select: typeof publicArticleSummarySelect }>;
type Detail = Prisma.ArticleGetPayload<{ select: typeof detailSelect }>;

export function mapPublicArticleSummary(row: Summary) {
  return {
    id: row.uuid, title: row.title, slug: row.slug, summary: row.summary,
    category: { id: row.category.uuid, slug: row.category.slug, name: row.category.name, translations: row.category.translations },
    subcategorySlug: row.subcategory.slug,
    subcategory: row.subcategory,
    isBreaking: row.isBreaking && !!row.breakingExpiresAt && row.breakingExpiresAt > new Date(),
    isFeatured: row.isFeatured, viewCount: row.viewCount, shareCount: row.shareCount,
    featuredImageUrl: row.featuredImageUrl, publishedAt: row.publishedAt!.toISOString(),
    translations: row.translations,
  };
}

function mapDetail(row: Detail) {
  return {
    ...mapPublicArticleSummary(row), content: row.content, viewCount: row.viewCount, shareCount: row.shareCount,
    authorName: row.createdBy ? `${row.createdBy.firstName} ${row.createdBy.lastName}`.trim() : null,
    translations: row.translations,
    tags: row.tags.map(({ tag }) => ({ slug: tag.slug, name: tag.name, translations: tag.translations })),
  };
}

async function activeTenant(tenantId: string) {
  if (!z.string().uuid().safeParse(tenantId).success) throw validationError("Invalid tenant ID");
  return findActiveTenantById(tenantId);
}

export function publicArticleWhere(tenantId: string, now = new Date()): Prisma.ArticleWhereInput {
  return { tenantUuid: tenantId, status: ArticleStatus.PUBLISHED, publishedAt: { lte: now } };
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
    ...publicArticleWhere(tenant.uuid),
    ...(categorySlug ? { category: { slug: categorySlug } } : {}),
    ...(subcategorySlug ? { subcategory: { slug: subcategorySlug } } : {}),
    ...(tagSlug ? { tags: { some: { tag: { slug: tagSlug } } } } : {}),
    ...(featured === true ? { isFeatured: true } : {}),
    ...(breaking === true ? { isBreaking: true, breakingExpiresAt: { gt: new Date() } } : {}),
    ...(search ? { OR: [
      { title: { contains: search, mode: "insensitive" } },
      { summary: { contains: search, mode: "insensitive" } },
      { translations: { some: { title: { contains: search, mode: "insensitive" } } } },
    ] } : {}),
  };
  const [items, total] = await prisma.$transaction([
    prisma.article.findMany({ where, select: publicArticleSummarySelect,
      orderBy: [{ publishedAt: "desc" }, { uuid: "desc" }], skip: (page - 1) * pageSize, take: pageSize }),
    prisma.article.count({ where }),
  ]);
  return { items: items.map(mapPublicArticleSummary), total, page, pageSize };
}

export async function publicWebsiteArticle(tenantId: string, slug: string) {
  const parsed = slugSchema.safeParse(slug);
  if (!parsed.success) return null;
  const tenant = await activeTenant(tenantId);
  if (!tenant) return null;
  const row = await prisma.article.findFirst({
    where: { ...publicArticleWhere(tenant.uuid), slug: parsed.data },
    select: detailSelect,
  });
  return row ? mapDetail(row) : null;
}

export async function publicWebsiteRelatedArticles(tenantId: string, slug: string, limit = 4) {
  const parsedSlug = slugSchema.safeParse(slug);
  const parsedLimit = relatedLimitSchema.safeParse(limit);
  if (!parsedSlug.success || !parsedLimit.success) return [];
  const tenant = await activeTenant(tenantId);
  if (!tenant) return [];
  const now = new Date();
  const scope = publicArticleWhere(tenant.uuid, now);
  const current = await prisma.article.findFirst({
    where: { ...scope, slug: parsedSlug.data },
    select: { uuid: true, categoryUuid: true, subcategoryUuid: true,
      tags: { select: { tagUuid: true } } },
  });
  if (!current) return [];
  const tagIds = current.tags.map((item) => item.tagUuid);
  const sharedTags: Prisma.ArticleWhereInput = { tags: { some: { tagUuid: { in: tagIds } } } };
  const tiers: Prisma.ArticleWhereInput[] = [
    ...(tagIds.length ? [{ subcategoryUuid: current.subcategoryUuid, ...sharedTags }] : []),
    { subcategoryUuid: current.subcategoryUuid },
    ...(tagIds.length ? [{ categoryUuid: current.categoryUuid, ...sharedTags }] : []),
    { categoryUuid: current.categoryUuid },
    ...(tagIds.length ? [sharedTags] : []),
    {},
  ];
  const results: Summary[] = [];
  const excludedIds = [current.uuid];
  for (const tier of tiers) {
    const remaining = parsedLimit.data - results.length;
    if (!remaining) break;
    const rows = await prisma.article.findMany({
      where: { ...scope, ...tier, uuid: { notIn: [...excludedIds] } },
      select: publicArticleSummarySelect,
      orderBy: [{ publishedAt: "desc" }, { uuid: "desc" }], take: remaining,
    });
    results.push(...rows);
    excludedIds.push(...rows.map((row) => row.uuid));
  }
  return results.map(mapPublicArticleSummary);
}

export async function publicWebsitePopularArticles(tenantId: string, limit = 4) {
  const parsedLimit = relatedLimitSchema.safeParse(limit);
  if (!parsedLimit.success) return [];
  const tenant = await activeTenant(tenantId);
  if (!tenant) return [];
  const now = new Date();
  const recent = new Date(now.getTime() - POPULAR_WINDOW_DAYS * 86_400_000);
  const scope = publicArticleWhere(tenant.uuid, now);
  const ranked = await prisma.$queryRaw<{ articleUuid: string }[]>`
    SELECT v."article_uuid" AS "articleUuid"
    FROM "article_views" v
    JOIN "articles" a ON a."uuid" = v."article_uuid" AND a."tenant_uuid" = v."tenant_uuid"
    WHERE v."tenant_uuid" = ${tenant.uuid}
      AND v."viewed_at" >= ${recent}
      AND a."status" = 'PUBLISHED'::"ArticleStatus"
      AND a."published_at" <= ${now}
    GROUP BY v."article_uuid", a."published_at"
    ORDER BY COUNT(*) DESC, a."published_at" DESC, v."article_uuid" DESC
    LIMIT ${parsedLimit.data}
  `;
  const articles = ranked.length ? await prisma.article.findMany({
    where: { ...scope, uuid: { in: ranked.map((item) => item.articleUuid) } },
    select: publicArticleSummarySelect,
  }) : [];
  const byId = new Map(articles.map((article) => [article.uuid, article]));
  const popular = ranked.flatMap(({ articleUuid }) => {
    const article = byId.get(articleUuid);
    return article ? [mapPublicArticleSummary(article)] : [];
  });
  const remaining = parsedLimit.data - popular.length;
  if (!remaining) return popular;
  const recentArticles = await prisma.article.findMany({
    where: { ...scope, uuid: { notIn: popular.map((article) => article.id) } },
    select: publicArticleSummarySelect,
    orderBy: [{ publishedAt: "desc" }, { uuid: "desc" }],
    take: remaining,
  });
  return [...popular, ...recentArticles.map(mapPublicArticleSummary)];
}
