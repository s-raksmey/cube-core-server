import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import type { SessionPayload } from "@/src/lib/auth/session";

const grants = vi.hoisted(() => new Map<string, string[]>());
vi.mock("@/src/modules/roles/role-permission.service", () => ({
  getTenantUserPermissions: async (session: SessionPayload) => grants.get(session.userId) ?? [],
}));

import { articleWorkflow, createArticle, deleteArticle, getArticle, listArticles, setArticlePresentation, updateArticle } from "@/src/modules/articles/article.service";
import { publishDueArticles } from "@/src/modules/articles/article-scheduler";

const databaseDescribe = process.env.RUN_ARTICLE_DATABASE_TESTS === "1" ? describe.sequential : describe.skip;
databaseDescribe("Article tenant isolation and editorial workflow", () => {
  const db = new PrismaClient();
  const tenantA = randomUUID(), tenantB = randomUUID();
  const authorId = randomUUID(), reviewerId = randomUUID(), publisherId = randomUUID(), otherId = randomUUID();
  const editorGrants = ["ARTICLE_VIEW", "ARTICLE_CREATE", "ARTICLE_UPDATE_OWN", "ARTICLE_DELETE_OWN", "ARTICLE_SUBMIT", "CATEGORY_VIEW", "CATEGORY_VIEW_SUBCATEGORY", "TAG_VIEW"];
  const reviewerGrants = ["ARTICLE_VIEW", "ARTICLE_REVIEW"];
  const publisherGrants = ["ARTICLE_VIEW", "ARTICLE_CREATE", "ARTICLE_UPDATE_ANY", "ARTICLE_PUBLISH", "ARTICLE_SCHEDULE", "ARTICLE_ARCHIVE", "ARTICLE_RESTORE", "ARTICLE_SET_BREAKING", "ARTICLE_SET_FEATURED", "CATEGORY_VIEW", "CATEGORY_VIEW_SUBCATEGORY", "TAG_VIEW"];
  const session = (userId: string, tenantId = tenantA): SessionPayload => ({ userId, tenantId, role: "EDITOR", audience: "TENANT_APP", sessionId: randomUUID() });
  const author = session(authorId), reviewer = session(reviewerId), publisher = session(publisherId), other = session(otherId, tenantB);
  let categoryA: string, subcategoryA: string, subcategoryOther: string, categoryB: string, subcategoryB: string;
  let tagA: string, tagB: string, articleA: string, articleB: string;
  const input = (overrides: Record<string, unknown> = {}) => ({
    title: "Digital news", slug: "digital-news", summary: "A summary", content: "## Hello\nArticle body",
    categoryId: categoryA, subcategoryId: subcategoryA, tagIds: [tagA], translations: [], ...overrides,
  });
  beforeAll(async () => {
    grants.set(authorId, editorGrants); grants.set(reviewerId, reviewerGrants);
    grants.set(publisherId, publisherGrants); grants.set(otherId, publisherGrants);
    await db.tenant.createMany({ data: [tenantA, tenantB].map((uuid) => ({ uuid, name: "Article integration", slug: `article-test-${uuid}`, type: "SUB" })) });
    await db.user.createMany({ data: [authorId, reviewerId, publisherId, otherId].map((uuid) => ({ uuid, firstName: "Test", lastName: "User", email: `article-${uuid}@example.test`, status: "ACTIVE" })) });
    categoryA = (await db.category.create({ data: { tenantUuid: tenantA, name: "News", slug: "news" } })).uuid;
    categoryB = (await db.category.create({ data: { tenantUuid: tenantB, name: "News", slug: "news" } })).uuid;
    subcategoryA = (await db.subcategory.create({ data: { tenantUuid: tenantA, categoryUuid: categoryA, slug: "technology" } })).uuid;
    subcategoryOther = (await db.subcategory.create({ data: { tenantUuid: tenantA, categoryUuid: categoryA, slug: "education" } })).uuid;
    subcategoryB = (await db.subcategory.create({ data: { tenantUuid: tenantB, categoryUuid: categoryB, slug: "technology" } })).uuid;
    tagA = (await db.tag.create({ data: { tenantUuid: tenantA, name: "AI", slug: "ai" } })).uuid;
    tagB = (await db.tag.create({ data: { tenantUuid: tenantB, name: "AI", slug: "ai" } })).uuid;
  });
  afterAll(async () => {
    await db.auditLog.deleteMany({ where: { tenantUuid: { in: [tenantA, tenantB] } } });
    await db.article.deleteMany({ where: { tenantUuid: { in: [tenantA, tenantB] } } });
    await db.tenant.deleteMany({ where: { uuid: { in: [tenantA, tenantB] } } });
    await db.user.deleteMany({ where: { uuid: { in: [authorId, reviewerId, publisherId, otherId] } } });
    await db.$disconnect();
  });

  it("creates tenant-owned drafts and allows the same slug in another tenant", async () => {
    articleA = (await createArticle(author, input()))!.id;
    articleB = (await createArticle(other, input({ categoryId: categoryB, subcategoryId: subcategoryB, tagIds: [tagB] })))!.id;
    expect((await getArticle(author, articleA))?.status).toBe("DRAFT");
    expect((await getArticle(author, articleA))?.authorId).toBe(authorId);
    expect((await getArticle(author, articleA))?.translations).toEqual([]);
    await expect(createArticle(author, input())).rejects.toThrow("slug already exists");
  });
  it("isolates reads, edits, workflow actions, categories, subcategories and tags", async () => {
    expect((await listArticles(author, {})).items.map((item) => item.id)).toEqual([articleA]);
    expect(await getArticle(author, articleB)).toBeNull();
    await expect(updateArticle(author, articleB, { title: "Stolen" })).rejects.toMatchObject({ extensions: { code: "NOT_FOUND" } });
    await expect(articleWorkflow(publisher, articleB, "publish")).rejects.toMatchObject({ extensions: { code: "NOT_FOUND" } });
    await expect(createArticle(author, input({ slug: "wrong-category", categoryId: categoryB }))).rejects.toThrow("Select a category");
    await expect(createArticle(author, input({ slug: "wrong-subcategory", subcategoryId: subcategoryB }))).rejects.toThrow("Select a category");
    await expect(createArticle(author, input({ slug: "wrong-tag", tagIds: [tagB] }))).rejects.toThrow("do not belong");
    await expect(createArticle(author, input({ slug: "wrong-pair", categoryId: categoryA, subcategoryId: subcategoryB }))).rejects.toThrow("Select a category");
  });
  it("enforces ownership and validates translation locales", async () => {
    await expect(updateArticle(session(reviewerId), articleA, { title: "Stolen" })).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
    await expect(updateArticle(author, articleA, { translations: [{ locale: "en", title: "English", content: "Text" }] })).rejects.toMatchObject({ extensions: { code: "VALIDATION" } });
    await expect(updateArticle(author, articleA, { translations: [{ locale: "km", title: "Khmer", content: "Text" }, { locale: "KM", title: "Duplicate", content: "Text" }] })).rejects.toMatchObject({ extensions: { code: "VALIDATION" } });
    await updateArticle(author, articleA, { translations: [{ locale: "KM", title: "ព័ត៌មានឌីជីថល", content: "Content" }] });
    expect((await getArticle(author, articleA))?.translations.map((item) => item.locale)).toEqual(["km"]);
    expect((await listArticles(author, { search: "ព័ត៌មានឌីជីថល" })).items).toHaveLength(1);
    await updateArticle(author, articleA, { translations: [], subcategoryId: subcategoryOther });
    expect((await getArticle(author, articleA))?.translations).toEqual([]);
    await updateArticle(author, articleA, { subcategoryId: subcategoryA });
  });
  it("keeps direct publishing and deletion independent of role names and review permission", async () => {
    const directId = (await createArticle(author, input({ slug: "direct-publish", title: "Direct publish" })))!.id;
    await expect(articleWorkflow(author, directId, "schedule", new Date(Date.now() + 60_000).toISOString()))
      .rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
    await expect(articleWorkflow(reviewer, directId, "publish"))
      .rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
    grants.set(reviewerId, [...reviewerGrants, "ARTICLE_PUBLISH"]);
    try {
      await articleWorkflow(reviewer, directId, "publish");
      expect((await getArticle(author, directId))?.publishedById).toBe(reviewerId);
      await expect(deleteArticle(author, directId)).rejects.toMatchObject({ extensions: { code: "VALIDATION" } });
    } finally {
      grants.set(reviewerId, reviewerGrants);
    }
    const deleteId = (await createArticle(author, input({ slug: "delete-draft", title: "Delete draft" })))!.id;
    await expect(deleteArticle(reviewer, deleteId)).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
    expect(await deleteArticle(author, deleteId)).toBe(true);
    expect(await getArticle(author, deleteId)).toBeNull();
  });
  it("runs submit, changes, resubmit, publish, archive and restore with independent permissions", async () => {
    await expect(articleWorkflow(author, articleA, "publish")).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
    await expect(articleWorkflow(reviewer, articleA, "publish")).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
    await expect(updateArticle(session(reviewerId), articleA, { title: "Stolen" })).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
    await articleWorkflow(author, articleA, "submit");
    await expect(updateArticle(author, articleA, { title: "Changed during review" })).rejects.toMatchObject({ extensions: { code: "VALIDATION" } });
    await expect(articleWorkflow(reviewer, articleA, "requestChanges", " ")).rejects.toMatchObject({ extensions: { code: "VALIDATION" } });
    await articleWorkflow(reviewer, articleA, "requestChanges", "Verify the source");
    await updateArticle(author, articleA, { title: "Verified digital news" });
    await articleWorkflow(author, articleA, "submit");
    await articleWorkflow(publisher, articleA, "publish");
    const published = await getArticle(author, articleA);
    expect(published?.status).toBe("PUBLISHED"); expect(published?.publishedById).toBe(publisherId);
    expect(published?.reviews.map((review) => review.decision)).toEqual(["SUBMITTED", "CHANGES_REQUESTED", "SUBMITTED", "APPROVED"]);
    await expect(articleWorkflow(publisher, articleA, "publish")).rejects.toMatchObject({ extensions: { code: "VALIDATION" } });
    await expect(updateArticle(author, articleA, { title: "Unauthorized live edit" })).rejects.toMatchObject({ extensions: { code: "VALIDATION" } });
    await setArticlePresentation(publisher, articleA, "breaking", true);
    await setArticlePresentation(publisher, articleA, "featured", true);
    expect(await getArticle(author, articleA)).toMatchObject({ isBreaking: true, isFeatured: true });
    await articleWorkflow(publisher, articleA, "archive");
    expect((await getArticle(author, articleA))?.archivedAt).toBeTruthy();
    await articleWorkflow(publisher, articleA, "restore");
    expect(await getArticle(author, articleA)).toMatchObject({ status: "PUBLISHED", archivedAt: null });
  });
  it("schedules, changes and cancels from durable server state, then publishes due work once", async () => {
    const id = (await createArticle(publisher, input({ slug: "scheduled", title: "Scheduled" })))!.id;
    const first = new Date(Date.now() + 60_000).toISOString();
    const second = new Date(Date.now() + 120_000).toISOString();
    await articleWorkflow(publisher, id, "schedule", first);
    await articleWorkflow(publisher, id, "reschedule", second);
    expect(await publishDueArticles(new Date(Date.now() + 90_000))).toBe(0);
    await articleWorkflow(publisher, id, "cancelSchedule");
    expect((await getArticle(publisher, id))?.status).toBe("DRAFT");
    await articleWorkflow(publisher, id, "schedule", second);
    expect(await publishDueArticles(new Date(Date.now() + 130_000))).toBe(1);
    expect(await publishDueArticles(new Date(Date.now() + 130_000))).toBe(0);
    expect(await getArticle(publisher, id)).toMatchObject({ status: "PUBLISHED", publishedById: publisherId });
  });
});
