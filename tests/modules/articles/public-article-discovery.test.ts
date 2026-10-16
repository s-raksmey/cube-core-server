import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ArticleStatus } from "@prisma/client";

const mocks = vi.hoisted(() => ({ tenant: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn(), transaction: vi.fn(), query: vi.fn() }));
vi.mock("@/src/modules/tenants/tenant-domain.service", () => ({ findActiveTenantById: mocks.tenant }));
vi.mock("@/src/lib/db", () => ({ prisma: {
  article: { findFirst: mocks.findFirst, findMany: mocks.findMany, count: mocks.count },
  $transaction: mocks.transaction, $queryRaw: mocks.query,
} }));

import { mapPublicArticleSummary, publicWebsiteArticle, publicWebsiteArticles, publicWebsitePopularArticles, publicWebsiteRelatedArticles } from "@/src/modules/articles/public-article.service";

const tenantId = randomUUID();
const articleId = randomUUID();
const categoryId = randomUUID();
const subcategoryId = randomUUID();
const tagId = randomUUID();

function summary(uuid: string, title: string) {
  return { uuid, title, slug: title.toLowerCase().replaceAll(" ", "-"), summary: null,
    isBreaking: false, breakingExpiresAt: null, isFeatured: false, featuredImageUrl: null, publishedAt: new Date("2026-10-15T12:00:00Z"),
    viewCount: 7, shareCount: 3,
    category: { uuid: categoryId, slug: "news", name: "News", translations: [] },
    subcategory: { slug: "local", translations: [{ locale: "en", name: "Local" }] }, translations: [] };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.tenant.mockResolvedValue({ uuid: tenantId });
});

describe("public article discovery", () => {
  it("shows Breaking only before expiration and filters public Breaking reads by tenant and expiry", async () => {
    const breaking = { ...summary(articleId, "Breaking News"), isBreaking: true,
      breakingExpiresAt: new Date(Date.now() + 60_000) };
    expect(mapPublicArticleSummary(breaking).isBreaking).toBe(true);
    expect(mapPublicArticleSummary({ ...breaking, breakingExpiresAt: new Date(Date.now() - 1) }).isBreaking).toBe(false);
    mocks.transaction.mockResolvedValue([[breaking], 1]);
    await publicWebsiteArticles(tenantId, { breaking: true });
    expect(mocks.findMany.mock.calls[0][0].where).toMatchObject({
      tenantUuid: tenantId, status: ArticleStatus.PUBLISHED, isBreaking: true,
      breakingExpiresAt: { gt: expect.any(Date) },
    });
  });
  it("keeps latest reads published, tenant-scoped, publication-ordered, and summary-only", async () => {
    mocks.transaction.mockResolvedValue([[summary(articleId, "Public News")], 1]);
    const page = await publicWebsiteArticles(tenantId, {});
    expect(page.items.map((item) => item.title)).toEqual(["Public News"]);
    expect(page.items[0]?.shareCount).toBe(3);
    expect(mocks.transaction).toHaveBeenCalledOnce();
    const operations = mocks.transaction.mock.calls[0][0];
    expect(operations).toHaveLength(2);
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ tenantUuid: tenantId, status: ArticleStatus.PUBLISHED, publishedAt: { lte: expect.any(Date) } }),
      orderBy: [{ publishedAt: "desc" }, { uuid: "desc" }],
      select: expect.not.objectContaining({ content: true }),
      take: 12,
    }));
    expect(mocks.findMany.mock.calls[0][0].select).toMatchObject({ viewCount: true, shareCount: true });
  });

  it("returns public tags and view count without recording a view on a detail read", async () => {
    mocks.findFirst.mockResolvedValue({ ...summary(articleId, "Public News"), content: "Body", viewCount: 7, shareCount: 3,
      createdBy: null, tags: [{ tag: { slug: "politics", name: "Politics", translations: [{ locale: "km", name: "នយោបាយ" }] } }] });
    const article = await publicWebsiteArticle(tenantId, "public-news");
    expect(article?.tags).toEqual([{ slug: "politics", name: "Politics", translations: [{ locale: "km", name: "នយោបាយ" }] }]);
    expect(article?.viewCount).toBe(7);
    expect(article?.shareCount).toBe(3);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ tenantUuid: tenantId, status: ArticleStatus.PUBLISHED, slug: "public-news" }),
    }));
  });

  it("ranks related articles by relevance, excludes the current article, and does not duplicate results", async () => {
    const ids = Array.from({ length: 4 }, () => randomUUID());
    mocks.findFirst.mockResolvedValue({ uuid: articleId, categoryUuid: categoryId, subcategoryUuid: subcategoryId,
      tags: [{ tagUuid: tagId }] });
    ids.forEach((id, index) => mocks.findMany.mockResolvedValueOnce([summary(id, `Related ${index}`)]));
    const related = await publicWebsiteRelatedArticles(tenantId, "public-news", 4);
    expect(related.map((item) => item.id)).toEqual(ids);
    expect(related.map((item) => item.shareCount)).toEqual([3, 3, 3, 3]);
    expect(mocks.findMany).toHaveBeenCalledTimes(4);
    const calls = mocks.findMany.mock.calls.map(([args]) => args);
    expect(calls[0].where).toMatchObject({ tenantUuid: tenantId, status: ArticleStatus.PUBLISHED,
      subcategoryUuid: subcategoryId, tags: { some: { tagUuid: { in: [tagId] } } }, uuid: { notIn: [articleId] } });
    expect(calls[1].where.uuid.notIn).toEqual([articleId, ids[0]]);
    expect(calls[2].where).toMatchObject({ categoryUuid: categoryId, tags: { some: { tagUuid: { in: [tagId] } } } });
    expect(calls[3].where.uuid.notIn).toEqual([articleId, ...ids.slice(0, 3)]);
    expect(calls.every((call) => call.select.content !== true)).toBe(true);
  });

  it("ranks popular stories by recent tenant views and rechecks public status", async () => {
    const first = randomUUID(), second = randomUUID();
    mocks.query.mockResolvedValue([{ articleUuid: first }, { articleUuid: second }]);
    mocks.findMany.mockResolvedValue([
      { ...summary(second, "Second"), viewCount: 4 },
      { ...summary(first, "First"), viewCount: 12 },
    ]);
    const popular = await publicWebsitePopularArticles(tenantId, 2);
    expect(popular.map((item) => item.id)).toEqual([first, second]);
    expect(popular.map((item) => item.viewCount)).toEqual([12, 4]);
    expect(popular.map((item) => item.shareCount)).toEqual([3, 3]);
    const sql = (mocks.query.mock.calls[0][0] as TemplateStringsArray).join("?");
    expect(sql).toContain('v."viewed_at" >=');
    expect(sql).toContain('a."status" = \'PUBLISHED\'');
    expect(sql).toContain('ORDER BY COUNT(*) DESC, a."published_at" DESC');
    expect(mocks.query.mock.calls[0][1]).toBe(tenantId);
    expect(mocks.query.mock.calls[0][2]).toBeInstanceOf(Date);
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ tenantUuid: tenantId, status: ArticleStatus.PUBLISHED, uuid: { in: [first, second] } }),
      select: expect.objectContaining({ viewCount: true }),
    }));
  });

  it("fills popular news to four cards with recent published stories when views are sparse", async () => {
    const ids = Array.from({ length: 4 }, () => randomUUID());
    mocks.query.mockResolvedValue([{ articleUuid: ids[0] }]);
    mocks.findMany.mockResolvedValueOnce([summary(ids[0], "Viewed")])
      .mockResolvedValueOnce(ids.slice(1).map((id, index) => summary(id, `Recent ${index}`)));

    const popular = await publicWebsitePopularArticles(tenantId, 4);

    expect(popular.map((item) => item.id)).toEqual(ids);
    expect(mocks.findMany).toHaveBeenCalledTimes(2);
    expect(mocks.findMany.mock.calls[1][0]).toMatchObject({
      where: { tenantUuid: tenantId, status: ArticleStatus.PUBLISHED, uuid: { notIn: [ids[0]] } },
      select: expect.objectContaining({ viewCount: true }),
      orderBy: [{ publishedAt: "desc" }, { uuid: "desc" }],
      take: 3,
    });
  });
});
