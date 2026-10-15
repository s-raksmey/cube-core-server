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

const session: SessionPayload = { userId: randomUUID(), tenantId: randomUUID(),
  role: "EDITOR", audience: "TENANT_APP", sessionId: randomUUID() };
const id = randomUUID();
function article(status: ArticleStatus, createdByUuid = session.userId) {
  mocks.findFirst.mockResolvedValueOnce({ uuid: id, status, createdByUuid, title: "Article" }).mockResolvedValueOnce(null);
}

describe("Request Changes permission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findFirst.mockReset();
    mocks.permissions.mockResolvedValue(["ARTICLE_VIEW", "ARTICLE_UPDATE_OWN", "ARTICLE_REQUEST_CHANGES"]);
    mocks.updateMany.mockResolvedValue({ count: 1 });
  });

  it("allows the owner to request changes in review and retains the reason and audit trail", async () => {
    article(ArticleStatus.IN_REVIEW);
    await articleWorkflow(session, id, "requestChanges", "Verify the source");
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ uuid: id, tenantUuid: session.tenantId, status: ArticleStatus.IN_REVIEW }),
      data: expect.objectContaining({ status: ArticleStatus.DRAFT }),
    }));
    expect(mocks.createReview).toHaveBeenCalledWith({ data: expect.objectContaining({
      decision: "CHANGES_REQUESTED", comment: "Verify the source", reviewerUuid: session.userId,
    }) });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      action: "ARTICLE_CHANGES_REQUESTED", actorUserUuid: session.userId,
      metadata: expect.objectContaining({ comment: "Verify the source", previousStatus: ArticleStatus.IN_REVIEW, newStatus: ArticleStatus.DRAFT }),
    }), expect.anything());
  });

  it("does not infer permission from review, publish, or update access", async () => {
    mocks.permissions.mockResolvedValue(["ARTICLE_VIEW", "ARTICLE_REVIEW", "ARTICLE_PUBLISH", "ARTICLE_UPDATE_ANY"]);
    await expect(articleWorkflow(session, id, "requestChanges", "Fix it"))
      .rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });

  it("does not let the owner-only capability affect another author's Article", async () => {
    article(ArticleStatus.IN_REVIEW, randomUUID());
    await expect(articleWorkflow(session, id, "requestChanges", "Fix it"))
      .rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("lets an authorized reviewer request changes without edit-any permission", async () => {
    mocks.permissions.mockResolvedValue(["ARTICLE_VIEW", "ARTICLE_REVIEW", "ARTICLE_REQUEST_CHANGES"]);
    article(ArticleStatus.IN_REVIEW, randomUUID());
    await articleWorkflow(session, id, "requestChanges", "Fix it");
    expect(mocks.createReview).toHaveBeenCalledOnce();
  });

  it("rejects Published articles without unpublishing them", async () => {
    article(ArticleStatus.PUBLISHED);
    await expect(articleWorkflow(session, id, "requestChanges", "Fix it"))
      .rejects.toThrow("Unpublish this article before requesting changes");
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("requires a reason and tenant-scoped Article lookup", async () => {
    article(ArticleStatus.IN_REVIEW);
    await expect(articleWorkflow(session, id, "requestChanges", " "))
      .rejects.toMatchObject({ extensions: { code: "VALIDATION" } });
    expect(mocks.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { uuid: id, tenantUuid: session.tenantId },
    }));
    mocks.findFirst.mockReset().mockResolvedValue(null);
    await expect(articleWorkflow(session, id, "requestChanges", "Fix it"))
      .rejects.toMatchObject({ extensions: { code: "NOT_FOUND" } });
  });
});
