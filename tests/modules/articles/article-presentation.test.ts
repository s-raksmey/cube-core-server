import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ArticleStatus } from "@prisma/client";
import type { SessionPayload } from "@/src/lib/auth/session";

const mocks = vi.hoisted(() => ({ findFirst: vi.fn(), updateMany: vi.fn(), permissions: vi.fn(), audit: vi.fn() }));
vi.mock("@/src/lib/db", () => ({ prisma: {
  article: { findFirst: mocks.findFirst },
  $transaction: (work: (tx: unknown) => Promise<unknown>) => work({ article: { updateMany: mocks.updateMany } }),
} }));
vi.mock("@/src/modules/roles/role-permission.service", () => ({ getTenantUserPermissions: mocks.permissions }));
vi.mock("@/src/modules/articles/article-role-access", () => ({ assertCanManageArticleAuthor: vi.fn(), articleAuthorRoles: vi.fn().mockResolvedValue(new Map()) }));
vi.mock("@/src/modules/auth/audit-auth", () => ({ writeAuthAudit: mocks.audit }));

import { setArticlePresentation, updateArticle } from "@/src/modules/articles/article.service";

const session: SessionPayload = { userId: randomUUID(), tenantId: randomUUID(),
  role: "EDITOR", audience: "TENANT_APP", sessionId: randomUUID() };
const articleId = randomUUID();
const row = (status: ArticleStatus, createdByUuid = session.userId) => ({
  uuid: articleId, status, createdByUuid, title: "Article", isBreaking: false, isFeatured: false,
});
function article(status: ArticleStatus, createdByUuid?: string) {
  mocks.findFirst.mockResolvedValueOnce(row(status, createdByUuid)).mockResolvedValueOnce(null);
}

describe("article presentation permissions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findFirst.mockReset();
    mocks.permissions.mockResolvedValue(["ARTICLE_VIEW", "ARTICLE_UPDATE_OWN", "ARTICLE_SET_BREAKING", "ARTICLE_SET_FEATURED"]);
    mocks.updateMany.mockResolvedValue({ count: 1 });
  });

  it.each(["breaking", "featured"] as const)("lets an Editor change %s on their own Draft and audits the actor", async (kind) => {
    article(ArticleStatus.DRAFT);
    await setArticlePresentation(session, articleId, kind, true);
    expect(mocks.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { uuid: articleId, tenantUuid: session.tenantId } }));
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { uuid: articleId, tenantUuid: session.tenantId, status: ArticleStatus.DRAFT },
      data: { [kind === "breaking" ? "isBreaking" : "isFeatured"]: true },
    }));
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      action: `ARTICLE_${kind.toUpperCase()}_ENABLED`, actorUserUuid: session.userId,
    }), expect.anything());
  });

  it.each(["breaking", "featured"] as const)("does not let an Editor change another author's %s on a Draft", async (kind) => {
    article(ArticleStatus.DRAFT, randomUUID());
    await expect(setArticlePresentation(session, articleId, kind, true))
      .rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("does not treat presentation permissions as edit permission", async () => {
    mocks.permissions.mockResolvedValue(["ARTICLE_VIEW", "ARTICLE_SET_BREAKING", "ARTICLE_SET_FEATURED"]);
    article(ArticleStatus.DRAFT);
    await expect(setArticlePresentation(session, articleId, "breaking", true))
      .rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("lets a reviewer change flags in review without changing status", async () => {
    mocks.permissions.mockResolvedValue(["ARTICLE_VIEW", "ARTICLE_REVIEW", "ARTICLE_SET_FEATURED"]);
    article(ArticleStatus.IN_REVIEW, randomUUID());
    await setArticlePresentation(session, articleId, "featured", true);
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: ArticleStatus.IN_REVIEW }), data: { isFeatured: true },
    }));
  });

  it("requires review permission for an in-review article", async () => {
    article(ArticleStatus.IN_REVIEW);
    await expect(setArticlePresentation(session, articleId, "breaking", true))
      .rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
  });

  it.each(["breaking", "featured"] as const)("requires Unpublish before changing %s on a Published article", async (kind) => {
    article(ArticleStatus.PUBLISHED, randomUUID());
    await expect(setArticlePresentation(session, articleId, kind, true))
      .rejects.toThrow("Unpublish the article before changing Breaking or Featured");
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("also blocks flag changes through the normal edit mutation on Published articles", async () => {
    mocks.findFirst.mockResolvedValueOnce(row(ArticleStatus.PUBLISHED));
    await expect(updateArticle(session, articleId, { isBreaking: true, isFeatured: true }))
      .rejects.toThrow("Published articles must be unpublished before editing");
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("does not let an Editor update flags on an Admin's Draft through normal editing", async () => {
    mocks.findFirst.mockResolvedValueOnce(row(ArticleStatus.DRAFT, randomUUID()));
    await expect(updateArticle(session, articleId, { isBreaking: true, isFeatured: true }))
      .rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("rejects Archived articles and missing presentation permission", async () => {
    article(ArticleStatus.ARCHIVED);
    await expect(setArticlePresentation(session, articleId, "breaking", true))
      .rejects.toMatchObject({ extensions: { code: "VALIDATION" } });
    mocks.permissions.mockResolvedValue(["ARTICLE_VIEW", "ARTICLE_UPDATE_OWN"]);
    await expect(setArticlePresentation(session, articleId, "featured", true))
      .rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
  });
});
