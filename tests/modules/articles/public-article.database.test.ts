import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { publicWebsiteArticle, publicWebsiteArticles, publicWebsiteCategories, publicWebsiteTags } from "@/src/modules/articles/public-article.service";

const databaseDescribe = process.env.RUN_PUBLIC_ARTICLE_DATABASE_TESTS === "1" ? describe.sequential : describe.skip;
databaseDescribe("Public website article reads", () => {
  const db = new PrismaClient();
  const firstTenant = randomUUID(), secondTenant = randomUUID();
  const firstCategory = randomUUID(), emptyCategory = randomUUID(), secondCategory = randomUUID();
  const firstSubcategory = randomUUID(), emptySubcategory = randomUUID(), secondSubcategory = randomUUID();
  const firstTag = randomUUID(), secondTag = randomUUID(), draftTag = randomUUID();
  const publishedId = randomUUID(), draftId = randomUUID(), archivedId = randomUUID(), futureId = randomUUID(), otherId = randomUUID();
  beforeAll(async () => {
    await db.tenant.createMany({ data: [firstTenant, secondTenant].map((uuid) => ({ uuid, name: "Public test", slug: `public-${uuid}`, type: "SUB", status: "ACTIVE" })) });
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
    await db.article.createMany({ data: [
      { uuid: publishedId, tenantUuid: firstTenant, categoryUuid: firstCategory, subcategoryUuid: firstSubcategory,
        title: "Public story", slug: "public-story", content: "Published content", status: "PUBLISHED", publishedAt: new Date() },
      { uuid: draftId, tenantUuid: firstTenant, categoryUuid: firstCategory, subcategoryUuid: firstSubcategory,
        title: "Secret draft", slug: "secret-draft", content: "Private content", status: "DRAFT" },
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
    expect((await publicWebsiteArticle(firstTenant, "public-story"))?.content).toBe("Published content");
    expect(await publicWebsiteArticle(firstTenant, "secret-draft")).toBeNull();
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
  it("hides all content when a SUB tenant becomes inactive", async () => {
    await db.tenant.update({ where: { uuid: firstTenant }, data: { status: "SUSPENDED" } });
    expect((await publicWebsiteArticles(firstTenant, {})).items).toEqual([]);
    expect(await publicWebsiteCategories(firstTenant)).toEqual([]);
    expect(await publicWebsiteTags(firstTenant)).toEqual([]);
    expect(await publicWebsiteArticle(firstTenant, "public-story")).toBeNull();
  });
});
