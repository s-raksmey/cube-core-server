import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ArticleStatus } from "@prisma/client";
import type { SessionPayload } from "@/src/lib/auth/session";

const mocks = vi.hoisted(() => ({ findFirst: vi.fn(), permissions: vi.fn() }));
vi.mock("@/src/lib/db", () => ({ prisma: { article: { findFirst: mocks.findFirst } } }));
vi.mock("@/src/modules/roles/role-permission.service", () => ({
  getTenantUserPermissions: mocks.permissions,
}));

import { setArticlePresentation } from "@/src/modules/articles/article.service";

const session: SessionPayload = { userId: randomUUID(), tenantId: randomUUID(),
  role: "ADMIN", audience: "TENANT_APP", sessionId: randomUUID() };
const articleId = randomUUID();

describe("published article presentation controls", () => {
  beforeEach(() => {
    mocks.findFirst.mockReset();
    mocks.permissions.mockReset();
    mocks.permissions.mockResolvedValue(["ARTICLE_SET_BREAKING", "ARTICLE_SET_FEATURED"]);
    mocks.findFirst.mockResolvedValue({ uuid: articleId, status: ArticleStatus.PUBLISHED, title: "Live article" });
  });

  it.each(["breaking", "featured"] as const)("requires unpublish before changing %s", async (kind) => {
    await expect(setArticlePresentation(session, articleId, kind, true)).rejects.toThrow("Unpublish the article");
    expect(mocks.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { uuid: articleId, tenantUuid: session.tenantId } }));
  });

  it("still requires the separate presentation permission", async () => {
    mocks.permissions.mockResolvedValue([]);
    await expect(setArticlePresentation(session, articleId, "breaking", true)).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
  });
});
