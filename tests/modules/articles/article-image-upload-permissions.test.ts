import { randomUUID } from "node:crypto";
import { ArticleStatus, MembershipStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionPayload } from "@/src/lib/auth/session";

const mocks = vi.hoisted(() => ({ findFirst: vi.fn(), memberships: vi.fn(), permissions: vi.fn(), save: vi.fn() }));
vi.mock("@/src/lib/db", () => ({ prisma: {
  article: { findFirst: mocks.findFirst }, tenantMembership: { findMany: mocks.memberships },
} }));
vi.mock("@/src/modules/roles/role-permission.service", () => ({ getTenantUserPermissions: mocks.permissions }));
vi.mock("@/src/modules/articles/article-image.service", () => ({
  saveArticleContentImage: mocks.save, saveArticleThumbnail: vi.fn(), removeArticleThumbnail: vi.fn(),
}));

import { uploadArticleImage } from "@/src/modules/articles/article.service";

const editor: SessionPayload = { userId: randomUUID(), tenantId: randomUUID(), role: "EDITOR",
  audience: "TENANT_APP", sessionId: randomUUID() };
const adminId = randomUUID();
const articleId = randomUUID();
const image = { fileName: "photo.png", mimeType: "image/png", contentBase64: "YWJj" };
const member = (userUuid: string, code: "ADMIN" | "EDITOR") =>
  ({ userUuid, status: MembershipStatus.ACTIVE, role: { code } });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.save.mockResolvedValue("/storage/tenants/example/article-content/photo.png");
});

describe("article content image upload", () => {
  it("allows a creator to upload before saving an article", async () => {
    mocks.permissions.mockResolvedValue(["ARTICLE_VIEW", "ARTICLE_CREATE"]);
    await expect(uploadArticleImage(editor, null, image)).resolves.toContain("/storage/");
    expect(mocks.save).toHaveBeenCalledWith(editor.tenantId, image);
  });

  it("requires create permission for a new article", async () => {
    mocks.permissions.mockResolvedValue(["ARTICLE_VIEW"]);
    await expect(uploadArticleImage(editor, null, image)).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("blocks an Editor from uploading to an Admin article even with update-any permission", async () => {
    mocks.permissions.mockResolvedValue(["ARTICLE_VIEW", "ARTICLE_UPDATE_ANY"]);
    mocks.findFirst.mockResolvedValue({ uuid: articleId, createdByUuid: adminId, status: ArticleStatus.DRAFT });
    mocks.memberships.mockResolvedValue([member(editor.userId, "EDITOR"), member(adminId, "ADMIN")]);
    await expect(uploadArticleImage(editor, articleId, image)).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("allows an Editor to upload to their own draft, but not a published article", async () => {
    mocks.permissions.mockResolvedValue(["ARTICLE_VIEW", "ARTICLE_UPDATE_OWN"]);
    mocks.findFirst.mockResolvedValue({ uuid: articleId, createdByUuid: editor.userId, status: ArticleStatus.DRAFT });
    mocks.memberships.mockResolvedValue([member(editor.userId, "EDITOR")]);
    await expect(uploadArticleImage(editor, articleId, image)).resolves.toContain("/storage/");
    mocks.findFirst.mockResolvedValue({ uuid: articleId, createdByUuid: editor.userId, status: ArticleStatus.PUBLISHED });
    await expect(uploadArticleImage(editor, articleId, image)).rejects.toMatchObject({ extensions: { code: "VALIDATION" } });
  });
});
