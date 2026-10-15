import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { graphql } from "graphql";
import type { SessionPayload } from "@/src/lib/auth/session";
import { schema } from "@/src/graphql/resolvers/index";

const grants = vi.hoisted(() => new Map<string, string[]>());
vi.mock("@/src/modules/roles/role-permission.service", () => ({
  getTenantUserPermissions: async (session: SessionPayload) => grants.get(session.userId) ?? [],
}));
vi.mock("@/src/modules/articles/article-role-access", () => ({
  assertCanManageArticleAuthor: async () => {},
  articleAuthorRoles: async () => new Map(),
}));

import { articleWorkflow, createArticle, deleteArticle, deleteArchivedArticle, getArticle, listArticles, setArticlePresentation, updateArticle } from "@/src/modules/articles/article.service";
import { publishDueArticles } from "@/src/modules/articles/article-scheduler";
import { publicWebsiteArticle, publicWebsiteArticles } from "@/src/modules/articles/public-article.service";

const databaseDescribe = process.env.RUN_ARTICLE_DATABASE_TESTS === "1" ? describe.sequential : describe.skip;
databaseDescribe("Article tenant isolation and editorial workflow", () => {
  const db = new PrismaClient();
  const tenantA = randomUUID(), tenantB = randomUUID();
  const authorId = randomUUID(), reviewerId = randomUUID(), publisherId = randomUUID(), otherId = randomUUID();
  const editorGrants = ["ARTICLE_VIEW", "ARTICLE_CREATE", "ARTICLE_UPDATE_OWN", "ARTICLE_DELETE_OWN", "ARTICLE_SUBMIT", "ARTICLE_REQUEST_CHANGES", "ARTICLE_SET_BREAKING", "ARTICLE_SET_FEATURED", "CATEGORY_VIEW", "CATEGORY_VIEW_SUBCATEGORY", "TAG_VIEW"];
  const reviewerGrants = ["ARTICLE_VIEW", "ARTICLE_REVIEW", "ARTICLE_REQUEST_CHANGES"];
  const publisherGrants = ["ARTICLE_VIEW", "ARTICLE_CREATE", "ARTICLE_UPDATE_ANY", "ARTICLE_REVIEW", "ARTICLE_REQUEST_CHANGES", "ARTICLE_PUBLISH", "ARTICLE_UNPUBLISH", "ARTICLE_SCHEDULE", "ARTICLE_ARCHIVE", "ARTICLE_RESTORE", "ARTICLE_DELETE_ARCHIVED", "ARTICLE_SET_BREAKING", "ARTICLE_SET_FEATURED", "CATEGORY_VIEW", "CATEGORY_VIEW_SUBCATEGORY", "TAG_VIEW"];
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
  it("requires the dedicated permission and Article access for Request Changes", async () => {
    const id = (await createArticle(author, input({ slug: "change-access", title: "Change access" })))!.id;
    await articleWorkflow(author, id, "submit");
    grants.set(reviewerId, ["ARTICLE_VIEW", "ARTICLE_REVIEW"]);
    try {
      await expect(articleWorkflow(reviewer, id, "requestChanges", "Fix source"))
        .rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
    } finally { grants.set(reviewerId, reviewerGrants); }
    await expect(articleWorkflow(other, id, "requestChanges", "Cross tenant"))
      .rejects.toMatchObject({ extensions: { code: "NOT_FOUND" } });
    await expect(articleWorkflow(author, id, "publish"))
      .rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
    await expect(articleWorkflow(author, id, "unpublish"))
      .rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
    await articleWorkflow(reviewer, id, "requestChanges", "Verify the source");
    expect(await getArticle(author, id)).toMatchObject({ status: "DRAFT",
      reviews: [expect.objectContaining({ decision: "SUBMITTED" }),
        expect.objectContaining({ decision: "CHANGES_REQUESTED", comment: "Verify the source" })] });
    expect(await db.auditLog.findFirst({ where: { tenantUuid: tenantA, targetUuid: id, action: "ARTICLE_CHANGES_REQUESTED" },
      select: { actorUserUuid: true, metadata: true } })).toEqual({ actorUserUuid: reviewerId,
      metadata: expect.objectContaining({ comment: "Verify the source", previousStatus: "IN_REVIEW", newStatus: "DRAFT" }) });
    await articleWorkflow(author, id, "submit");
    await articleWorkflow(author, id, "requestChanges", "Revise my draft");
    expect((await getArticle(author, id))?.status).toBe("DRAFT");
    await articleWorkflow(publisher, id, "publish");
    await expect(articleWorkflow(publisher, id, "requestChanges", "Fix live article"))
      .rejects.toThrow("Unpublish this article before requesting changes");
    const directRequest = await graphql({ schema,
      source: "mutation($id: ID!, $comment: String!) { requestArticleChanges(id: $id, comment: $comment) { id } }",
      variableValues: { id, comment: "Fix live article" },
      contextValue: { session: publisher, tenantHostMismatch: false, trustedAuthAudience: null, request: new Request("http://localhost/graphql") } });
    expect(directRequest.errors?.[0]?.message).toContain("Unpublish this article before requesting changes");
    expect((await getArticle(author, id))?.status).toBe("PUBLISHED");
    await articleWorkflow(publisher, id, "unpublish");
    expect((await getArticle(author, id))?.status).toBe("DRAFT");
    await articleWorkflow(author, id, "submit");
    await articleWorkflow(reviewer, id, "requestChanges", "Correct the unpublished article");
    expect((await getArticle(author, id))?.status).toBe("DRAFT");
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
  it("requires unpublish before editing published content, flags, or archive", async () => {
    await expect(articleWorkflow(author, articleA, "publish")).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
    await expect(articleWorkflow(reviewer, articleA, "publish")).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
    await expect(updateArticle(session(reviewerId), articleA, { title: "Stolen" })).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
    await articleWorkflow(author, articleA, "submit");
    await expect(updateArticle(author, articleA, { title: "Changed during review" })).rejects.toMatchObject({ extensions: { code: "VALIDATION" } });
    await expect(updateArticle(publisher, articleA, { title: "Publisher edit during review" })).rejects.toMatchObject({ extensions: { code: "VALIDATION" } });
    await expect(articleWorkflow(publisher, articleA, "unpublish")).rejects.toMatchObject({ extensions: { code: "VALIDATION" } });
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
    const directGraphqlUpdate = await graphql({ schema, source: "mutation($id: ID!, $input: UpdateArticleInput!) { updateArticle(id: $id, input: $input) { id } }",
      variableValues: { id: articleA, input: { title: "GraphQL live edit" } },
      contextValue: { session: publisher, tenantHostMismatch: false, trustedAuthAudience: null, request: new Request("http://localhost/graphql") } });
    expect(directGraphqlUpdate.errors?.[0]?.extensions?.code).toBe("VALIDATION");
    for (const change of [{ title: "Locked title" }, { slug: "locked-slug" }, { content: "Locked content" },
      { categoryId: categoryA }, { subcategoryId: subcategoryOther }, { tagIds: [] },
      { translations: [{ locale: "km", title: "Locked", content: "Locked" }] },
      { featuredImageUrl: "https://example.test/locked.jpg" }, { isBreaking: true }, { isFeatured: true }]) {
      await expect(updateArticle(publisher, articleA, change)).rejects.toThrow("Published articles must be unpublished before editing");
    }
    await expect(articleWorkflow(author, articleA, "unpublish")).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
    await expect(articleWorkflow(publisher, articleB, "unpublish")).rejects.toMatchObject({ extensions: { code: "NOT_FOUND" } });
    await expect(setArticlePresentation(publisher, articleA, "breaking", true)).rejects.toThrow("Unpublish the article");
    await expect(setArticlePresentation(publisher, articleA, "featured", true)).rejects.toThrow("Unpublish the article");
    const directBreaking = await graphql({ schema, source: "mutation($id: ID!) { setArticleBreaking(id: $id, enabled: true) { id } }",
      variableValues: { id: articleA },
      contextValue: { session: publisher, tenantHostMismatch: false, trustedAuthAudience: null, request: new Request("http://localhost/graphql") } });
    expect(directBreaking.errors?.[0]?.extensions?.code).toBe("VALIDATION");
    expect(await getArticle(author, articleA)).toMatchObject({ status: "PUBLISHED", isBreaking: false, isFeatured: false });
    await expect(articleWorkflow(publisher, articleA, "archive")).rejects.toMatchObject({ extensions: { code: "VALIDATION" } });
    expect((await publicWebsiteArticles(tenantA, { categorySlug: "news", search: "digital" })).items.map((item) => item.id)).toContain(articleA);
    expect(await publicWebsiteArticle(tenantA, "digital-news")).not.toBeNull();
    const beforeUnpublish = await getArticle(author, articleA);
    await articleWorkflow(publisher, articleA, "unpublish");
    expect(await db.auditLog.findMany({ where: { tenantUuid: tenantA, targetUuid: articleA, action: "ARTICLE_UNPUBLISHED" },
      select: { actorUserUuid: true, metadata: true } })).toEqual([{ actorUserUuid: publisherId,
      metadata: expect.objectContaining({ previousStatus: "PUBLISHED", newStatus: "DRAFT" }) }]);
    expect(await getArticle(author, articleA)).toMatchObject({ status: "DRAFT", publishedAt: beforeUnpublish?.publishedAt,
      content: beforeUnpublish?.content, tags: beforeUnpublish?.tags, translations: beforeUnpublish?.translations,
      reviews: beforeUnpublish?.reviews });
    expect((await publicWebsiteArticles(tenantA, { categorySlug: "news", search: "digital" })).items.map((item) => item.id)).not.toContain(articleA);
    expect(await publicWebsiteArticle(tenantA, "digital-news")).toBeNull();
    expect((await publicWebsiteArticles(tenantA, { tagSlug: "ai" })).items.map((item) => item.id)).not.toContain(articleA);
    await expect(articleWorkflow(publisher, articleA, "unpublish")).rejects.toMatchObject({ extensions: { code: "VALIDATION" } });
    await expect(setArticlePresentation(reviewer, articleA, "breaking", true)).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
    await expect(setArticlePresentation(publisher, articleB, "featured", true)).rejects.toMatchObject({ extensions: { code: "NOT_FOUND" } });
    await setArticlePresentation(publisher, articleA, "breaking", true);
    await setArticlePresentation(publisher, articleA, "featured", true);
    expect(await getArticle(author, articleA)).toMatchObject({ status: "DRAFT", isBreaking: true, isFeatured: true });
    expect((await publicWebsiteArticles(tenantA, { breaking: true, featured: true })).items.map((item) => item.id)).not.toContain(articleA);
    await updateArticle(author, articleA, { title: "Republished digital news" });
    await articleWorkflow(publisher, articleA, "publish");
    expect(await getArticle(author, articleA)).toMatchObject({ status: "PUBLISHED", isBreaking: true, isFeatured: true });
    await expect(articleWorkflow(publisher, articleA, "archive")).rejects.toMatchObject({ extensions: { code: "VALIDATION" } });
    await articleWorkflow(publisher, articleA, "unpublish");
    await articleWorkflow(publisher, articleA, "archive");
    expect((await getArticle(author, articleA))?.archivedAt).toBeTruthy();
    await expect(updateArticle(publisher, articleA, { title: "Archived edit" })).rejects.toMatchObject({ extensions: { code: "VALIDATION" } });
    expect(await publicWebsiteArticle(tenantA, "digital-news")).toBeNull();
    await articleWorkflow(publisher, articleA, "restore");
    expect(await getArticle(author, articleA)).toMatchObject({ status: "DRAFT", archivedAt: null });
    await updateArticle(publisher, articleA, { title: "Restored edit" });
    expect(await publicWebsiteArticle(tenantA, "digital-news")).toBeNull();
  });
  it("schedules, changes and cancels from durable server state, then publishes due work once", async () => {
    const id = (await createArticle(publisher, input({ slug: "scheduled", title: "Scheduled" })))!.id;
    const first = new Date(Date.now() + 60_000).toISOString();
    const second = new Date(Date.now() + 120_000).toISOString();
    await articleWorkflow(publisher, id, "schedule", first);
    await expect(updateArticle(publisher, id, { title: "Scheduled edit" })).rejects.toMatchObject({ extensions: { code: "VALIDATION" } });
    await expect(articleWorkflow(publisher, id, "unpublish")).rejects.toMatchObject({ extensions: { code: "VALIDATION" } });
    await articleWorkflow(publisher, id, "reschedule", second);
    expect(await publishDueArticles(new Date(Date.now() + 90_000))).toBe(0);
    await articleWorkflow(publisher, id, "cancelSchedule");
    expect((await getArticle(publisher, id))?.status).toBe("DRAFT");
    await updateArticle(publisher, id, { title: "Editable after cancellation" });
    await articleWorkflow(publisher, id, "schedule", second);
    expect(await publishDueArticles(new Date(Date.now() + 130_000))).toBe(1);
    expect(await publishDueArticles(new Date(Date.now() + 130_000))).toBe(0);
    expect(await getArticle(publisher, id)).toMatchObject({ status: "PUBLISHED", publishedById: publisherId });
  });
  it("keeps scheduling scoped to an Editor's own article unless review or edit-any access is granted", async () => {
    grants.set(authorId, [...editorGrants, "ARTICLE_SCHEDULE"]);
    try {
      const own = (await createArticle(author, input({ slug: "own-schedule", title: "Own schedule" })))!.id;
      const adminDraft = (await createArticle(publisher, input({ slug: "admin-schedule", title: "Admin schedule" })))!.id;
      const adminScheduled = (await createArticle(publisher, input({ slug: "admin-scheduled", title: "Admin scheduled" })))!.id;
      const first = new Date(Date.now() + 3_600_000).toISOString();
      const second = new Date(Date.now() + 7_200_000).toISOString();
      await expect(articleWorkflow(author, adminDraft, "schedule", first))
        .rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
      await articleWorkflow(author, own, "schedule", first);
      await articleWorkflow(publisher, adminScheduled, "schedule", first);
      await expect(articleWorkflow(author, adminScheduled, "reschedule", second))
        .rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
      await expect(articleWorkflow(author, adminScheduled, "cancelSchedule"))
        .rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
      await articleWorkflow(author, own, "reschedule", second);
      await articleWorkflow(author, own, "cancelSchedule");
      expect((await getArticle(author, own))?.status).toBe("DRAFT");
      await articleWorkflow(author, own, "submit");
      await expect(articleWorkflow(author, own, "schedule", first))
        .rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
      expect((await getArticle(author, adminDraft))?.status).toBe("DRAFT");
    } finally { grants.set(authorId, editorGrants); }
  });
  it("keeps Archive scoped to an Editor's own Draft unless edit-any access is granted", async () => {
    grants.set(authorId, [...editorGrants, "ARTICLE_ARCHIVE"]);
    try {
      const own = (await createArticle(author, input({ slug: "own-archive", title: "Own archive" })))!.id;
      const adminDraft = (await createArticle(publisher, input({ slug: "admin-archive", title: "Admin archive" })))!.id;
      await expect(articleWorkflow(author, adminDraft, "archive"))
        .rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
      expect((await getArticle(publisher, adminDraft))?.status).toBe("DRAFT");
      await articleWorkflow(author, own, "archive");
      expect((await getArticle(author, own))?.status).toBe("ARCHIVED");
      await articleWorkflow(publisher, adminDraft, "archive");
      expect((await getArticle(publisher, adminDraft))?.status).toBe("ARCHIVED");
    } finally { grants.set(authorId, editorGrants); }
  });
  it("keeps Editor flags private until the reviewer finalizes publication", async () => {
    const id = (await createArticle(author, input({ slug: "editor-flags", title: "Editor flags", isBreaking: true, isFeatured: true })))!.id;
    expect(await getArticle(author, id)).toMatchObject({ status: "DRAFT", isBreaking: true, isFeatured: true });
    expect((await publicWebsiteArticles(tenantA, { breaking: true, featured: true })).items.map((item) => item.id)).not.toContain(id);
    await updateArticle(author, id, { isBreaking: false, isFeatured: false });
    expect(await getArticle(author, id)).toMatchObject({ isBreaking: false, isFeatured: false });
    grants.set(reviewerId, [...reviewerGrants, "ARTICLE_UPDATE_OWN", "ARTICLE_SET_BREAKING", "ARTICLE_SET_FEATURED"]);
    try {
      await expect(updateArticle(reviewer, id, { isBreaking: true })).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
      await expect(setArticlePresentation(reviewer, id, "featured", true)).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
    } finally { grants.set(reviewerId, reviewerGrants); }
    await updateArticle(author, id, { isBreaking: true });
    await articleWorkflow(author, id, "submit");
    expect(await getArticle(author, id)).toMatchObject({ status: "IN_REVIEW", isBreaking: true, isFeatured: false });
    expect((await publicWebsiteArticles(tenantA, { breaking: true })).items.map((item) => item.id)).not.toContain(id);
    await setArticlePresentation(publisher, id, "breaking", false);
    await setArticlePresentation(publisher, id, "featured", true);
    expect(await getArticle(author, id)).toMatchObject({ status: "IN_REVIEW", isBreaking: false, isFeatured: true });
    await expect(articleWorkflow(author, id, "publish")).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
    await articleWorkflow(publisher, id, "publish");
    expect(await getArticle(author, id)).toMatchObject({ status: "PUBLISHED", isBreaking: false, isFeatured: true });
    expect((await publicWebsiteArticles(tenantA, { featured: true })).items.map((item) => item.id)).toContain(id);
    expect((await publicWebsiteArticles(tenantA, { breaking: true })).items.map((item) => item.id)).not.toContain(id);
    expect(await db.auditLog.count({ where: { tenantUuid: tenantA, targetUuid: id, action: "ARTICLE_BREAKING_DISABLED", actorUserUuid: publisherId } })).toBe(1);
  });
  it("preserves reviewed flags through scheduling and automatic publication", async () => {
    const id = (await createArticle(author, input({ slug: "scheduled-flags", title: "Scheduled flags", isBreaking: true })))!.id;
    await articleWorkflow(author, id, "submit");
    await setArticlePresentation(publisher, id, "featured", true);
    const due = new Date(Date.now() + 60_000);
    await articleWorkflow(publisher, id, "schedule", due.toISOString());
    expect(await getArticle(author, id)).toMatchObject({ status: "SCHEDULED", isBreaking: true, isFeatured: true });
    expect((await publicWebsiteArticles(tenantA, { featured: true })).items.map((item) => item.id)).not.toContain(id);
    await publishDueArticles(new Date(due.getTime() + 1000));
    expect(await getArticle(author, id)).toMatchObject({ status: "PUBLISHED", isBreaking: true, isFeatured: true });
  });
  it("permanently deletes only archived articles with the separate permission", async () => {
    const before = await getArticle(author, articleA);
    expect(before?.status).toBe("DRAFT");
    expect(before?.reviews.length).toBeGreaterThan(0);
    await expect(deleteArchivedArticle(publisher, articleA)).rejects.toMatchObject({ extensions: { code: "VALIDATION" } });
    await articleWorkflow(publisher, articleA, "archive");
    await expect(deleteArchivedArticle(author, articleA)).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
    await expect(deleteArchivedArticle(publisher, articleB)).rejects.toMatchObject({ extensions: { code: "NOT_FOUND" } });
    expect(await deleteArchivedArticle(publisher, articleA)).toBe(true);
    expect(await getArticle(author, articleA)).toBeNull();
    expect(await db.articleReview.count({ where: { articleUuid: articleA } })).toBe(0);
    expect(await db.category.count({ where: { uuid: categoryA } })).toBe(1);
    expect(await db.tag.count({ where: { uuid: tagA } })).toBe(1);
    expect(await db.auditLog.count({ where: { tenantUuid: tenantA, targetUuid: articleA, action: "ARTICLE_PERMANENTLY_DELETED" } })).toBe(1);
    await expect(deleteArchivedArticle(publisher, articleA)).rejects.toMatchObject({ extensions: { code: "NOT_FOUND" } });
  });
});
