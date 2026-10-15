import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { publicWebsiteArticle, publicWebsiteArticles, publicWebsiteCategories, publicWebsiteTags, publicWebsiteRelatedArticles, publicWebsitePopularArticles } from "@/src/modules/articles/public-article.service";
import { recordPublicWebsiteArticleView } from "@/src/modules/articles/public-article-view.service";
import { recordPublicWebsiteArticleShare } from "@/src/modules/articles/public-article-share.service";

const databaseDescribe = process.env.RUN_PUBLIC_ARTICLE_DATABASE_TESTS === "1" ? describe.sequential : describe.skip;
databaseDescribe("Public website article reads", () => {
  const db = new PrismaClient();
  const firstTenant = randomUUID(), secondTenant = randomUUID();
  const firstCategory = randomUUID(), emptyCategory = randomUUID(), secondCategory = randomUUID();
  const firstSubcategory = randomUUID(), emptySubcategory = randomUUID(), secondSubcategory = randomUUID();
  const firstTag = randomUUID(), secondTag = randomUUID(), draftTag = randomUUID();
  const publishedId = randomUUID(), draftId = randomUUID(), reviewId = randomUUID(), scheduledId = randomUUID(), archivedId = randomUUID(), futureId = randomUUID(), otherId = randomUUID();
  const relatedId = randomUUID(), sameTopicId = randomUUID(), fallbackId = randomUUID();
  const firstHostname = `public-${firstTenant}.example.test`;
  const secondHostname = `public-${secondTenant}.example.test`;
  beforeAll(async () => {
    await db.tenant.createMany({ data: [firstTenant, secondTenant].map((uuid) => ({ uuid, name: "Public test", slug: `public-${uuid}`, type: "SUB", status: "ACTIVE" })) });
    await db.tenantDomain.createMany({ data: [
      { tenantUuid: firstTenant, hostname: firstHostname, purpose: "WEBSITE", status: "ACTIVE", verifiedAt: new Date() },
      { tenantUuid: secondTenant, hostname: secondHostname, purpose: "WEBSITE", status: "ACTIVE", verifiedAt: new Date() },
    ] });
    await db.category.createMany({ data: [
      { uuid: firstCategory, tenantUuid: firstTenant, name: "News", slug: "news" },
      { uuid: emptyCategory, tenantUuid: firstTenant, name: "Events", slug: "events" },
      { uuid: secondCategory, tenantUuid: secondTenant, name: "News", slug: "news" },
    ] });
    await db.subcategory.createMany({ data: [
      { uuid: firstSubcategory, tenantUuid: firstTenant, categoryUuid: firstCategory, slug: "general" },
      { uuid: emptySubcategory, tenantUuid: firstTenant, categoryUuid: emptyCategory, slug: "local" },
      { uuid: secondSubcategory, tenantUuid: secondTenant, categoryUuid: secondCategory, slug: "general" },
    ] });
    await db.tag.createMany({ data: [
      { uuid: firstTag, tenantUuid: firstTenant, name: "Politics", slug: "politics" },
      { uuid: draftTag, tenantUuid: firstTenant, name: "Private", slug: "private" },
      { uuid: secondTag, tenantUuid: secondTenant, name: "Politics", slug: "politics" },
    ] });
    await db.tagTranslation.create({ data: { tagUuid: firstTag, locale: "km", name: "នយោបាយ" } });
    await db.article.createMany({ data: [
      { uuid: publishedId, tenantUuid: firstTenant, categoryUuid: firstCategory, subcategoryUuid: firstSubcategory,
        title: "Public story", slug: "public-story", content: "Published content", status: "PUBLISHED", publishedAt: new Date() },
      { uuid: draftId, tenantUuid: firstTenant, categoryUuid: firstCategory, subcategoryUuid: firstSubcategory,
        title: "Secret draft", slug: "secret-draft", content: "Private content", status: "DRAFT" },
      { uuid: reviewId, tenantUuid: firstTenant, categoryUuid: firstCategory, subcategoryUuid: firstSubcategory,
        title: "Review story", slug: "review-story", content: "Review content", status: "IN_REVIEW" },
      { uuid: scheduledId, tenantUuid: firstTenant, categoryUuid: firstCategory, subcategoryUuid: firstSubcategory,
        title: "Scheduled story", slug: "scheduled-story", content: "Scheduled content", status: "SCHEDULED", scheduledAt: new Date(Date.now() + 86_400_000) },
      { uuid: archivedId, tenantUuid: firstTenant, categoryUuid: firstCategory, subcategoryUuid: firstSubcategory,
        title: "Old story", slug: "old-story", content: "Archived content", status: "ARCHIVED", publishedAt: new Date() },
      { uuid: futureId, tenantUuid: firstTenant, categoryUuid: firstCategory, subcategoryUuid: firstSubcategory,
        title: "Embargoed story", slug: "embargoed-story", content: "Future content", status: "PUBLISHED", publishedAt: new Date(Date.now() + 86_400_000) },
      { uuid: otherId, tenantUuid: secondTenant, categoryUuid: secondCategory, subcategoryUuid: secondSubcategory,
        title: "Other tenant", slug: "other-tenant", content: "Other content", status: "PUBLISHED", publishedAt: new Date() },
    ] });
    await db.articleTag.createMany({ data: [
      { articleUuid: publishedId, tagUuid: firstTag, tenantUuid: firstTenant },
      { articleUuid: draftId, tagUuid: draftTag, tenantUuid: firstTenant },
      { articleUuid: otherId, tagUuid: secondTag, tenantUuid: secondTenant },
    ] });
  });
  afterAll(async () => {
    await db.article.deleteMany({ where: { tenantUuid: { in: [firstTenant, secondTenant] } } });
    await db.tenant.deleteMany({ where: { uuid: { in: [firstTenant, secondTenant] } } });
    await db.$disconnect();
  });
  it("returns only published content for the active requested tenant", async () => {
    const page = await publicWebsiteArticles(firstTenant, {});
    expect(page.items.map((item) => item.slug)).toEqual(["public-story"]);
    const categories = await publicWebsiteCategories(firstTenant);
    expect(categories.map((item) => item.slug)).toEqual(["events", "news"]);
    expect(categories.find((item) => item.slug === "events")?.subcategories.map((item) => item.slug)).toEqual(["local"]);
    expect((await publicWebsiteArticles(firstTenant, { categorySlug: "events", subcategorySlug: "local" })).items).toEqual([]);
    expect((await publicWebsiteTags(firstTenant)).map((item) => item.slug)).toEqual(["politics"]);
    expect((await publicWebsiteArticle(firstTenant, "public-story"))?.tags.map((tag) => tag.slug)).toEqual(["politics"]);
    expect((await publicWebsiteArticle(firstTenant, "public-story"))?.tags[0]?.translations).toEqual([{ locale: "km", name: "នយោបាយ" }]);
    expect((await publicWebsiteArticle(firstTenant, "public-story"))?.content).toBe("Published content");
    expect(await publicWebsiteArticle(firstTenant, "secret-draft")).toBeNull();
    expect(await publicWebsiteArticle(firstTenant, "review-story")).toBeNull();
    expect(await publicWebsiteArticle(firstTenant, "scheduled-story")).toBeNull();
    expect(await publicWebsiteArticle(firstTenant, "old-story")).toBeNull();
    expect(await publicWebsiteArticle(firstTenant, "embargoed-story")).toBeNull();
    expect(await publicWebsiteArticle(firstTenant, "other-tenant")).toBeNull();
  });
  it("keeps search and category filters tenant-scoped and bounded", async () => {
    expect((await publicWebsiteArticles(firstTenant, { search: "Other" })).items).toEqual([]);
    expect((await publicWebsiteArticles(firstTenant, { categorySlug: "news", pageSize: 1 })).items).toHaveLength(1);
    expect((await publicWebsiteArticles(firstTenant, { categorySlug: "news", subcategorySlug: "general" })).items).toHaveLength(1);
    expect((await publicWebsiteArticles(firstTenant, { categorySlug: "news", subcategorySlug: "unknown" })).items).toHaveLength(0);
    expect((await publicWebsiteArticles(firstTenant, { tagSlug: "politics" })).items.map((item) => item.slug)).toEqual(["public-story"]);
    expect((await publicWebsiteArticles(firstTenant, { tagSlug: "private" })).items).toEqual([]);
    await expect(publicWebsiteArticles(firstTenant, { pageSize: 1000 })).rejects.toThrow();
  });
  it("ranks related public news by shared tags and subcategory before recent fallback", async () => {
    await db.article.createMany({ data: [
      { uuid: relatedId, tenantUuid: firstTenant, categoryUuid: firstCategory, subcategoryUuid: firstSubcategory,
        title: "Tagged related", slug: "tagged-related", status: "PUBLISHED", createdAt: new Date(Date.now() - 4 * 86_400_000), publishedAt: new Date(Date.now() - 3 * 86_400_000) },
      { uuid: sameTopicId, tenantUuid: firstTenant, categoryUuid: firstCategory, subcategoryUuid: firstSubcategory,
        title: "Same topic", slug: "same-topic", status: "PUBLISHED", createdAt: new Date(Date.now() - 10 * 86_400_000), publishedAt: new Date(Date.now() - 3_600_000) },
      { uuid: fallbackId, tenantUuid: firstTenant, categoryUuid: emptyCategory, subcategoryUuid: emptySubcategory,
        title: "Other section", slug: "other-section", status: "PUBLISHED", publishedAt: new Date(Date.now() - 60_000) },
    ] });
    await db.articleTag.create({ data: { tenantUuid: firstTenant, articleUuid: relatedId, tagUuid: firstTag } });
    const related = await publicWebsiteRelatedArticles(firstTenant, "public-story", 4);
    expect(related.map((item) => item.id)).toEqual([relatedId, sameTopicId, fallbackId]);
    expect(new Set(related.map((item) => item.id)).size).toBe(related.length);
    const latest = (await publicWebsiteArticles(firstTenant, {})).items.map((item) => item.id);
    expect(latest.indexOf(sameTopicId)).toBeLessThan(latest.indexOf(relatedId));
  });
  it("deduplicates public views and ranks recent popularity without old lifetime views", async () => {
    const record = (hostname: string, articleId: string, visitorId = randomUUID()) =>
      recordPublicWebsiteArticleView({ hostname, articleId, visitorId });
    const visitor = randomUUID();
    expect(await record(firstHostname, publishedId, visitor)).toBe(true);
    expect(await record(firstHostname, publishedId, visitor)).toBe(false);
    expect(await record(firstHostname, publishedId)).toBe(true);
    for (let index = 0; index < 3; index++) expect(await record(firstHostname, relatedId)).toBe(true);
    expect(await record(secondHostname, publishedId)).toBe(false);
    expect(await record(firstHostname, draftId)).toBe(false);
    expect(await record(firstHostname, futureId)).toBe(false);
    expect(await record(firstHostname, archivedId)).toBe(false);
    const oldDate = new Date(Date.now() - 9 * 86_400_000);
    await db.articleView.createMany({ data: Array.from({ length: 10 }, () => ({
      tenantUuid: firstTenant, articleUuid: fallbackId, visitorKey: randomUUID(), bucketStart: oldDate, viewedAt: oldDate,
    })) });
    await db.article.update({ where: { uuid: fallbackId }, data: { viewCount: 10 } });
    expect((await publicWebsiteArticle(firstTenant, "public-story"))?.viewCount).toBe(2);
    expect((await db.articleView.count({ where: { articleUuid: publishedId } }))).toBe(2);
    expect((await publicWebsitePopularArticles(firstTenant, 4)).map((item) => item.id)).toEqual([relatedId, publishedId]);
  });
  it("counts distinct share actions, rejects private/cross-tenant requests, and preserves view-based popularity", async () => {
    const visitorId = randomUUID();
    const share = (hostname: string, articleId: string, platform: "FACEBOOK" | "TELEGRAM" | "COPY_LINK" | "NATIVE") =>
      recordPublicWebsiteArticleShare({ hostname, articleId, visitorId, platform });
    expect(await share(firstHostname, publishedId, "FACEBOOK")).toBe(true);
    expect(await share(firstHostname, publishedId, "FACEBOOK")).toBe(false);
    expect(await share(firstHostname, publishedId, "TELEGRAM")).toBe(true);
    expect(await share(firstHostname, publishedId, "COPY_LINK")).toBe(true);
    expect(await share(firstHostname, relatedId, "FACEBOOK")).toBe(true);
    expect(await share(secondHostname, publishedId, "FACEBOOK")).toBe(false);
    for (const privateId of [draftId, reviewId, scheduledId, archivedId, futureId]) {
      expect(await share(firstHostname, privateId, "FACEBOOK")).toBe(false);
    }
    expect((await publicWebsiteArticle(firstTenant, "public-story"))?.shareCount).toBe(3);
    expect((await publicWebsiteArticles(firstTenant, {})).items.find((item) => item.id === publishedId)?.shareCount).toBe(3);
    expect((await publicWebsiteRelatedArticles(firstTenant, "tagged-related", 4)).find((item) => item.id === publishedId)?.shareCount).toBe(3);
    expect((await publicWebsitePopularArticles(firstTenant, 4)).find((item) => item.id === publishedId)?.shareCount).toBe(3);
    expect(await db.articleShare.count({ where: { articleUuid: publishedId } })).toBe(3);
    expect((await publicWebsitePopularArticles(firstTenant, 4)).map((item) => item.id)).toEqual([relatedId, publishedId]);
  });
  it("hides unpublished content from latest, related, popular, detail, and new views while retaining history", async () => {
    await db.article.update({ where: { uuid: relatedId }, data: { status: "DRAFT" } });
    expect(await publicWebsiteArticle(firstTenant, "tagged-related")).toBeNull();
    expect((await publicWebsiteArticles(firstTenant, {})).items.map((item) => item.id)).not.toContain(relatedId);
    expect((await publicWebsiteRelatedArticles(firstTenant, "public-story", 4)).map((item) => item.id)).not.toContain(relatedId);
    expect((await publicWebsitePopularArticles(firstTenant, 4)).map((item) => item.id)).not.toContain(relatedId);
    expect(await recordPublicWebsiteArticleView({ hostname: firstHostname, articleId: relatedId, visitorId: randomUUID() })).toBe(false);
    expect(await db.articleView.count({ where: { articleUuid: relatedId } })).toBe(3);
    expect(await recordPublicWebsiteArticleShare({ hostname: firstHostname, articleId: relatedId, visitorId: randomUUID(), platform: "FACEBOOK" })).toBe(false);
    expect(await db.articleShare.count({ where: { articleUuid: relatedId } })).toBe(1);
    expect(await db.articleShare.count({ where: { articleUuid: publishedId } })).toBe(3);
  });
  it("retains the share count when an unpublished article is republished", async () => {
    await db.article.update({ where: { uuid: relatedId }, data: { status: "PUBLISHED" } });
    expect((await publicWebsiteArticle(firstTenant, "tagged-related"))?.shareCount).toBe(1);
  });
  it("cascades historical share events when an archived article is permanently deleted", async () => {
    await db.articleShare.create({ data: {
      tenantUuid: firstTenant, articleUuid: archivedId, platform: "FACEBOOK", visitorKey: randomUUID(),
      bucketStart: new Date(), sharedAt: new Date(),
    } });
    await db.article.delete({ where: { uuid: archivedId } });
    expect(await db.articleShare.count({ where: { articleUuid: archivedId } })).toBe(0);
  });
  it("hides all content when a SUB tenant becomes inactive", async () => {
    await db.tenant.update({ where: { uuid: firstTenant }, data: { status: "SUSPENDED" } });
    expect((await publicWebsiteArticles(firstTenant, {})).items).toEqual([]);
    expect(await publicWebsiteCategories(firstTenant)).toEqual([]);
    expect(await publicWebsiteTags(firstTenant)).toEqual([]);
    expect(await publicWebsiteArticle(firstTenant, "public-story")).toBeNull();
  });
});
