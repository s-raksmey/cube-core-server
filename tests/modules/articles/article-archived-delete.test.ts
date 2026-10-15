import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ArticleStatus } from "@prisma/client";
import type { SessionPayload } from "@/src/lib/auth/session";

const mocks = vi.hoisted(() => ({ findFirst: vi.fn(), remove: vi.fn(), permissions: vi.fn(), audit: vi.fn() }));
vi.mock("@/src/lib/db", () => ({ prisma: {
  article: { findFirst: mocks.findFirst },
  $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback({ article: { delete: mocks.remove } }),
} }));
vi.mock("@/src/modules/roles/role-permission.service", () => ({ getTenantUserPermissions: mocks.permissions }));
vi.mock("@/src/modules/auth/audit-auth", () => ({ writeAuthAudit: mocks.audit }));

import { deleteArchivedArticle } from "@/src/modules/articles/article.service";

const session: SessionPayload = { userId: randomUUID(), tenantId: randomUUID(), role: "EDITOR",
  audience: "TENANT_APP", sessionId: randomUUID() };
const articleId = randomUUID();

describe("archived article permanent deletion", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.permissions.mockResolvedValue(["ARTICLE_VIEW", "ARTICLE_DELETE_ARCHIVED"]);
    mocks.findFirst.mockResolvedValue({ uuid: articleId, title: "Archived article", status: ArticleStatus.ARCHIVED });
    mocks.remove.mockResolvedValue({ uuid: articleId });
  });

  it("deletes an archived article by tenant and status and writes an audit event", async () => {
    expect(await deleteArchivedArticle(session, articleId)).toBe(true);
    expect(mocks.remove).toHaveBeenCalledWith({ where: { uuid: articleId, tenantUuid: session.tenantId, status: ArticleStatus.ARCHIVED } });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "ARTICLE_PERMANENTLY_DELETED",
      actorUserUuid: session.userId, tenantUuid: session.tenantId, targetUuid: articleId }), expect.any(Object));
  });

  it("rejects a user without the archived-delete permission", async () => {
    mocks.permissions.mockResolvedValue(["ARTICLE_VIEW", "ARTICLE_DELETE_ANY"]);
    await expect(deleteArchivedArticle(session, articleId)).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("rejects a draft even with permission", async () => {
    mocks.findFirst.mockResolvedValue({ uuid: articleId, title: "Draft article", status: ArticleStatus.DRAFT });
    await expect(deleteArchivedArticle(session, articleId)).rejects.toMatchObject({ extensions: { code: "VALIDATION" } });
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("does not reveal another tenant's article", async () => {
    mocks.findFirst.mockResolvedValue(null);
    await expect(deleteArchivedArticle(session, articleId)).rejects.toMatchObject({ extensions: { code: "NOT_FOUND" } });
    expect(mocks.remove).not.toHaveBeenCalled();
  });
});
