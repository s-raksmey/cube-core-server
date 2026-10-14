import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";

// Opt-in: RUN_TAG_DATABASE_TESTS=1, with DATABASE_URL set, runs against the local database.
const databaseDescribe = process.env.RUN_TAG_DATABASE_TESTS === "1" ? describe : describe.skip;
databaseDescribe("Tags relational database guarantees", () => {
  const db = new PrismaClient();
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  let tagA: string;
  let tagB: string;
  let articleA: string;
  beforeAll(async () => {
    await db.tenant.createMany({ data: [tenantA, tenantB].map(uuid => ({ uuid, name: "Tags integration test", slug: `tags-test-${uuid}`, type: "SUB" })) });
    tagA = (await db.tag.create({ data: { tenantUuid: tenantA, name: "Artificial Intelligence", slug: "ai" } })).uuid;
    tagB = (await db.tag.create({ data: { tenantUuid: tenantB, name: "AI", slug: "ai" } })).uuid;
    articleA = (await db.article.create({ data: { tenantUuid: tenantA, title: "Tags test article" } })).uuid;
  });
  afterAll(async () => {
    await db.tenant.deleteMany({ where: { uuid: { in: [tenantA, tenantB] } } });
    await db.$disconnect();
  });
  it("allows identical slugs across tenants but rejects duplicates within a tenant", async () => {
    expect(tagA).not.toBe(tagB);
    await expect(db.tag.create({ data: { tenantUuid: tenantA, name: "Duplicate", slug: "ai" } })).rejects.toMatchObject({ code: "P2002" });
  });
  it("supports optional translations and unique locales", async () => {
    expect(await db.tagTranslation.count({ where: { tagUuid: tagA } })).toBe(0);
    await db.tagTranslation.createMany({ data: [{ tagUuid: tagA, locale: "km", name: "បញ្ញាសិប្បនិម្មិត" }, { tagUuid: tagA, locale: "zh", name: "人工智能" }] });
    await expect(db.tagTranslation.create({ data: { tagUuid: tagA, locale: "km", name: "Duplicate" } })).rejects.toMatchObject({ code: "P2002" });
  });
  it("supports tenant-scoped default-name, slug and translated-name search", async () => {
    for (const query of ["Artificial", "ai", "បញ្ញាសិប្បនិម្មិត"]) {
      const rows = await db.tag.findMany({ where: { tenantUuid: tenantA, OR: [{ name: { contains: query, mode: "insensitive" } }, { slug: { contains: query, mode: "insensitive" } }, { translations: { some: { name: { contains: query } } } }] }, select: { uuid: true } });
      expect(rows).toEqual([{ uuid: tagA }]);
    }
  });
  it("rejects cross-tenant article/tag links regardless of supplied tenant", async () => {
    for (const tenantUuid of [tenantA, tenantB]) await expect(db.articleTag.create({ data: { articleUuid: articleA, tagUuid: tagB, tenantUuid } })).rejects.toMatchObject({ code: "P2003" });
  });
  it("supports many tags per article and many articles per tag", async () => {
    const otherTag = await db.tag.create({ data: { tenantUuid: tenantA, name: "Technology", slug: "technology" } });
    const otherArticle = await db.article.create({ data: { tenantUuid: tenantA, title: "Another article" } });
    await db.articleTag.createMany({ data: [{ articleUuid: articleA, tagUuid: tagA, tenantUuid: tenantA }, { articleUuid: articleA, tagUuid: otherTag.uuid, tenantUuid: tenantA }, { articleUuid: otherArticle.uuid, tagUuid: tagA, tenantUuid: tenantA }] });
    expect(await db.articleTag.count({ where: { articleUuid: articleA } })).toBe(2);
    expect(await db.articleTag.count({ where: { tagUuid: tagA } })).toBe(2);
  });
  it("deletes tag translations and links while preserving articles", async () => {
    await db.tag.delete({ where: { uuid: tagA, tenantUuid: tenantA } });
    expect(await db.tagTranslation.count({ where: { tagUuid: tagA } })).toBe(0);
    expect(await db.articleTag.count({ where: { tagUuid: tagA } })).toBe(0);
    expect(await db.article.count({ where: { tenantUuid: tenantA } })).toBe(2);
  });
});
