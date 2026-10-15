import { randomUUID } from "node:crypto";
import { ArticleStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionPayload } from "@/src/lib/auth/session";

const mocks = vi.hoisted(() => ({ findFirst: vi.fn(), updateMany: vi.fn(), permissions: vi.fn(), audit: vi.fn() }));
vi.mock("@/src/lib/db", () => ({ prisma: {
  article: { findFirst: mocks.findFirst },
  $transaction: (work: (tx: unknown) => Promise<unknown>) => work({ article: { updateMany: mocks.updateMany } }),
} }));
vi.mock("@/src/modules/roles/role-permission.service", () => ({ getTenantUserPermissions: mocks.permissions }));
vi.mock("@/src/modules/articles/article-role-access", () => ({ assertCanManageArticleAuthor: vi.fn(), articleAuthorRoles: vi.fn().mockResolvedValue(new Map()) }));
vi.mock("@/src/modules/auth/audit-auth", () => ({ writeAuthAudit: mocks.audit }));

import { articleWorkflow } from "@/src/modules/articles/article.service";

const editor: SessionPayload = { userId: randomUUID(), tenantId: randomUUID(), role: "EDITOR",
  audience: "TENANT_APP", sessionId: randomUUID() };
const articleId = randomUUID();

function article(status: ArticleStatus, createdByUuid = editor.userId) {
  mocks.findFirst.mockResolvedValueOnce({ uuid: articleId, status, createdByUuid,
    title: "Article", slug: "article", content: "Body", categoryUuid: randomUUID(),
    subcategoryUuid: randomUUID(), translations: [] }).mockResolvedValueOnce(null);
}

describe("article archive access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findFirst.mockReset();
    mocks.permissions.mockResolvedValue(["ARTICLE_VIEW", "ARTICLE_ARCHIVE", "ARTICLE_UPDATE_OWN"]);
    mocks.updateMany.mockResolvedValue({ count: 1 });
  });

  it("lets an Editor archive their own Draft", async () => {
    article(ArticleStatus.DRAFT);
    await articleWorkflow(editor, articleId, "archive");
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ uuid: articleId, tenantUuid: editor.tenantId, status: ArticleStatus.DRAFT }),
      data: expect.objectContaining({ status: ArticleStatus.ARCHIVED }),
    }));
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "ARTICLE_ARCHIVED", actorUserUuid: editor.userId }), expect.anything());
  });

  it("prevents an Editor from archiving an Admin's Draft", async () => {
    article(ArticleStatus.DRAFT, randomUUID());
    await expect(articleWorkflow(editor, articleId, "archive"))
      .rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("requires view and edit access in addition to Archive permission", async () => {
    mocks.permissions.mockResolvedValue(["ARTICLE_VIEW", "ARTICLE_ARCHIVE"]);
    article(ArticleStatus.DRAFT);
    await expect(articleWorkflow(editor, articleId, "archive"))
      .rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
    mocks.findFirst.mockReset();
    mocks.permissions.mockResolvedValue(["ARTICLE_ARCHIVE", "ARTICLE_UPDATE_OWN"]);
    await expect(articleWorkflow(editor, articleId, "archive"))
      .rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("lets an edit-any user archive another author's Draft", async () => {
    mocks.permissions.mockResolvedValue(["ARTICLE_VIEW", "ARTICLE_ARCHIVE", "ARTICLE_UPDATE_ANY"]);
    article(ArticleStatus.DRAFT, randomUUID());
    await articleWorkflow(editor, articleId, "archive");
    expect(mocks.updateMany).toHaveBeenCalledOnce();
  });

  it("still rejects Published articles and articles outside the tenant", async () => {
    article(ArticleStatus.PUBLISHED);
    await expect(articleWorkflow(editor, articleId, "archive"))
      .rejects.toMatchObject({ extensions: { code: "VALIDATION" } });
    mocks.findFirst.mockReset().mockResolvedValue(null);
    await expect(articleWorkflow(editor, articleId, "archive"))
      .rejects.toMatchObject({ extensions: { code: "NOT_FOUND" } });
    expect(mocks.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { uuid: articleId, tenantUuid: editor.tenantId },
    }));
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });
});
