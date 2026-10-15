import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ArticleStatus } from "@prisma/client";
import type { SessionPayload } from "@/src/lib/auth/session";

const mocks = vi.hoisted(() => ({ findFirst: vi.fn(), updateMany: vi.fn(), createReview: vi.fn(), permissions: vi.fn(), audit: vi.fn() }));
vi.mock("@/src/lib/db", () => ({ prisma: {
  article: { findFirst: mocks.findFirst },
  $transaction: (work: (tx: unknown) => Promise<unknown>) => work({
    article: { updateMany: mocks.updateMany }, articleReview: { create: mocks.createReview },
  }),
} }));
vi.mock("@/src/modules/roles/role-permission.service", () => ({ getTenantUserPermissions: mocks.permissions }));
vi.mock("@/src/modules/articles/article-role-access", () => ({ assertCanManageArticleAuthor: vi.fn(), articleAuthorRoles: vi.fn().mockResolvedValue(new Map()) }));
vi.mock("@/src/modules/auth/audit-auth", () => ({ writeAuthAudit: mocks.audit }));

import { articleWorkflow } from "@/src/modules/articles/article.service";

const editor: SessionPayload = { userId: randomUUID(), tenantId: randomUUID(),
  role: "EDITOR", audience: "TENANT_APP", sessionId: randomUUID() };
const articleId = randomUUID();
const future = () => new Date(Date.now() + 3_600_000).toISOString();
function article(status: ArticleStatus, createdByUuid = editor.userId) {
  mocks.findFirst.mockResolvedValueOnce({ uuid: articleId, status, createdByUuid,
    title: "Article", slug: "article", content: "Body", categoryUuid: randomUUID(),
    subcategoryUuid: randomUUID(), translations: [], scheduledAt: new Date(Date.now() + 1_800_000),
  }).mockResolvedValueOnce(null);
}

describe("article schedule access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findFirst.mockReset();
    mocks.permissions.mockResolvedValue(["ARTICLE_VIEW", "ARTICLE_SCHEDULE", "ARTICLE_UPDATE_OWN"]);
    mocks.updateMany.mockResolvedValue({ count: 1 });
  });

  it("lets an Editor schedule their own Draft and audits the change", async () => {
    article(ArticleStatus.DRAFT);
    await articleWorkflow(editor, articleId, "schedule", future());
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ uuid: articleId, tenantUuid: editor.tenantId, status: ArticleStatus.DRAFT }),
      data: expect.objectContaining({ status: ArticleStatus.SCHEDULED, scheduledByUuid: editor.userId }),
    }));
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "ARTICLE_SCHEDULED", actorUserUuid: editor.userId }), expect.anything());
  });

  it("cannot schedule another author's Draft with schedule and edit-own permissions", async () => {
    article(ArticleStatus.DRAFT, randomUUID());
    await expect(articleWorkflow(editor, articleId, "schedule", future()))
      .rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("does not let the schedule permission replace edit access or article view", async () => {
    mocks.permissions.mockResolvedValue(["ARTICLE_VIEW", "ARTICLE_SCHEDULE"]);
    article(ArticleStatus.DRAFT);
    await expect(articleWorkflow(editor, articleId, "schedule", future()))
      .rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
    mocks.findFirst.mockReset();
    mocks.permissions.mockResolvedValue(["ARTICLE_SCHEDULE", "ARTICLE_UPDATE_OWN"]);
    await expect(articleWorkflow(editor, articleId, "schedule", future()))
      .rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("requires review access to schedule an In Review article", async () => {
    article(ArticleStatus.IN_REVIEW);
    await expect(articleWorkflow(editor, articleId, "schedule", future()))
      .rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("lets a reviewer schedule an In Review article but not another author's Draft", async () => {
    mocks.permissions.mockResolvedValue(["ARTICLE_VIEW", "ARTICLE_SCHEDULE", "ARTICLE_REVIEW"]);
    article(ArticleStatus.IN_REVIEW, randomUUID());
    await articleWorkflow(editor, articleId, "schedule", future());
    expect(mocks.createReview).toHaveBeenCalledOnce();
    article(ArticleStatus.DRAFT, randomUUID());
    await expect(articleWorkflow(editor, articleId, "schedule", future()))
      .rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
  });

  it.each(["reschedule", "cancelSchedule"] as const)("lets the owner %s their Scheduled article", async (action) => {
    article(ArticleStatus.SCHEDULED);
    await articleWorkflow(editor, articleId, action, action === "reschedule" ? future() : undefined);
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: ArticleStatus.SCHEDULED, tenantUuid: editor.tenantId }),
    }));
  });

  it.each(["reschedule", "cancelSchedule"] as const)("prevents an Editor from %s on another author's Scheduled article", async (action) => {
    article(ArticleStatus.SCHEDULED, randomUUID());
    await expect(articleWorkflow(editor, articleId, action, action === "reschedule" ? future() : undefined))
      .rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("does not change a Published article or one from another tenant", async () => {
    article(ArticleStatus.PUBLISHED);
    await expect(articleWorkflow(editor, articleId, "schedule", future()))
      .rejects.toMatchObject({ extensions: { code: "VALIDATION" } });
    mocks.findFirst.mockReset().mockResolvedValue(null);
    await expect(articleWorkflow(editor, articleId, "schedule", future()))
      .rejects.toMatchObject({ extensions: { code: "NOT_FOUND" } });
    expect(mocks.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { uuid: articleId, tenantUuid: editor.tenantId },
    }));
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });
});
