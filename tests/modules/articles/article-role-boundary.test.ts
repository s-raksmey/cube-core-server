import { randomUUID } from "node:crypto";
import { ArticleStatus, MembershipStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionPayload } from "@/src/lib/auth/session";

const mocks = vi.hoisted(() => ({ findFirst: vi.fn(), memberships: vi.fn(), permissions: vi.fn(), audit: vi.fn(), updateMany: vi.fn() }));
vi.mock("@/src/lib/db", () => ({ prisma: {
  article: { findFirst: mocks.findFirst },
  tenantMembership: { findMany: mocks.memberships },
  $transaction: (work: (tx: unknown) => Promise<unknown>) => work({ article: { updateMany: mocks.updateMany } }),
} }));
vi.mock("@/src/modules/roles/role-permission.service", () => ({ getTenantUserPermissions: mocks.permissions }));
vi.mock("@/src/modules/auth/audit-auth", () => ({ writeAuthAudit: mocks.audit }));

import { articleWorkflow, deleteArchivedArticle, deleteArticle, setArticlePresentation, updateArticle } from "@/src/modules/articles/article.service";
import { articleAuthorRoles } from "@/src/modules/articles/article-role-access";

const editor: SessionPayload = { userId: randomUUID(), tenantId: randomUUID(), role: "EDITOR",
  audience: "TENANT_APP", sessionId: randomUUID() };
const admin: SessionPayload = { ...editor, userId: randomUUID(), role: "ADMIN" };
const articleId = randomUUID();
const future = () => new Date(Date.now() + 3_600_000).toISOString();
const allPermissions = ["ARTICLE_VIEW", "ARTICLE_UPDATE_OWN", "ARTICLE_UPDATE_ANY", "ARTICLE_DELETE_OWN",
  "ARTICLE_DELETE_ANY", "ARTICLE_DELETE_ARCHIVED", "ARTICLE_SUBMIT", "ARTICLE_REQUEST_CHANGES", "ARTICLE_REVIEW",
  "ARTICLE_PUBLISH", "ARTICLE_UNPUBLISH", "ARTICLE_SCHEDULE", "ARTICLE_ARCHIVE", "ARTICLE_RESTORE",
  "ARTICLE_SET_BREAKING", "ARTICLE_SET_FEATURED"];
const member = (userUuid: string, code: "ADMIN" | "EDITOR", status = MembershipStatus.ACTIVE) =>
  ({ userUuid, status, role: { code } });
function row(status: ArticleStatus, createdByUuid: string) {
  return { uuid: articleId, status, createdByUuid, title: "Article", slug: "article", content: "Body",
    categoryUuid: randomUUID(), subcategoryUuid: randomUUID(), translations: [], isBreaking: false, isFeatured: false,
    scheduledAt: new Date(Date.now() + 1_800_000) };
}

describe("article author role boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.permissions.mockResolvedValue(allPermissions);
    mocks.updateMany.mockResolvedValue({ count: 1 });
  });

  it.each([
    ["update", ArticleStatus.DRAFT, (session: SessionPayload) => updateArticle(session, articleId, { title: "Changed" })],
    ["delete", ArticleStatus.DRAFT, (session: SessionPayload) => deleteArticle(session, articleId)],
    ["delete archived", ArticleStatus.ARCHIVED, (session: SessionPayload) => deleteArchivedArticle(session, articleId)],
    ["submit", ArticleStatus.DRAFT, (session: SessionPayload) => articleWorkflow(session, articleId, "submit")],
    ["request changes", ArticleStatus.IN_REVIEW, (session: SessionPayload) => articleWorkflow(session, articleId, "requestChanges", "Revise")],
    ["publish", ArticleStatus.DRAFT, (session: SessionPayload) => articleWorkflow(session, articleId, "publish")],
    ["schedule", ArticleStatus.DRAFT, (session: SessionPayload) => articleWorkflow(session, articleId, "schedule", future())],
    ["reschedule", ArticleStatus.SCHEDULED, (session: SessionPayload) => articleWorkflow(session, articleId, "reschedule", future())],
    ["cancel schedule", ArticleStatus.SCHEDULED, (session: SessionPayload) => articleWorkflow(session, articleId, "cancelSchedule")],
    ["unpublish", ArticleStatus.PUBLISHED, (session: SessionPayload) => articleWorkflow(session, articleId, "unpublish")],
    ["archive", ArticleStatus.DRAFT, (session: SessionPayload) => articleWorkflow(session, articleId, "archive")],
    ["restore", ArticleStatus.ARCHIVED, (session: SessionPayload) => articleWorkflow(session, articleId, "restore")],
    ["breaking", ArticleStatus.DRAFT, (session: SessionPayload) => setArticlePresentation(session, articleId, "breaking", true)],
    ["featured in review", ArticleStatus.IN_REVIEW, (session: SessionPayload) => setArticlePresentation(session, articleId, "featured", true)],
  ] as const)("blocks an Editor from %s on an Admin article even with every Article permission", async (_name, status, action) => {
    mocks.findFirst.mockResolvedValue(row(status, admin.userId));
    mocks.memberships.mockResolvedValue([member(editor.userId, "EDITOR"), member(admin.userId, "ADMIN")]);
    await expect(action(editor)).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
    expect(mocks.memberships).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantUuid: editor.tenantId, userUuid: { in: [editor.userId, admin.userId] } },
    }));
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("allows an Admin to manage an Editor article with the matching permission", async () => {
    mocks.findFirst.mockResolvedValueOnce(row(ArticleStatus.DRAFT, editor.userId)).mockResolvedValueOnce(null);
    mocks.memberships.mockResolvedValue([member(admin.userId, "ADMIN"), member(editor.userId, "EDITOR")]);
    await articleWorkflow(admin, articleId, "archive");
    expect(mocks.updateMany).toHaveBeenCalledOnce();
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "ARTICLE_ARCHIVED" }), expect.anything());
  });

  it("allows granted cross-author actions between Editors", async () => {
    const otherEditorId = randomUUID();
    mocks.findFirst.mockResolvedValueOnce(row(ArticleStatus.DRAFT, otherEditorId)).mockResolvedValueOnce(null);
    mocks.memberships.mockResolvedValue([member(editor.userId, "EDITOR"), member(otherEditorId, "EDITOR")]);
    await articleWorkflow(editor, articleId, "archive");
    expect(mocks.updateMany).toHaveBeenCalledOnce();
  });

  it("rejects a stale Admin session after its membership is changed to Editor", async () => {
    mocks.findFirst.mockResolvedValue(row(ArticleStatus.DRAFT, editor.userId));
    mocks.memberships.mockResolvedValue([member(admin.userId, "EDITOR"), member(editor.userId, "EDITOR")]);
    await expect(articleWorkflow(admin, articleId, "archive"))
      .rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("denies Editors when the author's current tenant role is unavailable", async () => {
    mocks.findFirst.mockResolvedValue(row(ArticleStatus.DRAFT, admin.userId));
    mocks.memberships.mockResolvedValue([member(editor.userId, "EDITOR")]);
    await expect(articleWorkflow(editor, articleId, "archive"))
      .rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
  });

  it("reads author roles only from the requested tenant with a narrow projection", async () => {
    mocks.memberships.mockResolvedValue([member(admin.userId, "ADMIN"), member(editor.userId, "EDITOR")]);
    const roles = await articleAuthorRoles(editor.tenantId, [admin.userId, editor.userId, admin.userId, null]);
    expect(roles.get(admin.userId)).toBe("ADMIN");
    expect(roles.get(editor.userId)).toBe("EDITOR");
    expect(mocks.memberships).toHaveBeenCalledWith({
      where: { tenantUuid: editor.tenantId, userUuid: { in: [admin.userId, editor.userId] } },
      select: { userUuid: true, role: { select: { code: true } } },
    });
  });
});
