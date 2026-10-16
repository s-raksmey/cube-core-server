import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ArticleStatus } from "@prisma/client";
import type { SessionPayload } from "@/src/lib/auth/session";

const mocks = vi.hoisted(() => ({ findFirst: vi.fn(), findMany: vi.fn(), tenant: vi.fn(), updateMany: vi.fn(),
  permissions: vi.fn(), audit: vi.fn() }));
vi.mock("@/src/lib/db", () => ({ prisma: {
  article: { findFirst: mocks.findFirst, findMany: mocks.findMany },
  $transaction: (work: (tx: unknown) => Promise<unknown>) => work({
    article: { updateMany: mocks.updateMany }, tenant: { findUnique: mocks.tenant },
  }),
} }));
vi.mock("@/src/modules/roles/role-permission.service", () => ({ getTenantUserPermissions: mocks.permissions }));
vi.mock("@/src/modules/articles/article-role-access", () => ({ assertCanManageArticleAuthor: vi.fn(), articleAuthorRoles: vi.fn().mockResolvedValue(new Map()) }));
vi.mock("@/src/modules/auth/audit-auth", () => ({ writeAuthAudit: mocks.audit }));

import { articleWorkflow } from "@/src/modules/articles/article.service";
import { publishDueArticles } from "@/src/modules/articles/article-scheduler";

const session = { userId: randomUUID(), tenantId: randomUUID(), role: "ADMIN", audience: "TENANT_APP", sessionId: randomUUID() } as SessionPayload;
const articleId = randomUUID();
const publishTime = new Date("2026-10-16T10:00:00.000Z");

function draft(isBreaking: boolean) {
  return { uuid: articleId, tenantUuid: session.tenantId, status: ArticleStatus.DRAFT, createdByUuid: session.userId,
    title: "Article", slug: "article", content: "Body", categoryUuid: randomUUID(), subcategoryUuid: randomUUID(),
    translations: [], isBreaking, isFeatured: false, scheduledAt: null };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.permissions.mockResolvedValue(["ARTICLE_VIEW", "ARTICLE_PUBLISH", "ARTICLE_UNPUBLISH"]);
  mocks.updateMany.mockResolvedValue({ count: 1 });
  mocks.tenant.mockResolvedValue({ settings: {} });
});

describe("Breaking publication expiration", () => {
  it("sets the 24-hour default at immediate publication", async () => {
    mocks.findFirst.mockResolvedValueOnce(draft(true)).mockResolvedValueOnce(null);
    await articleWorkflow(session, articleId, "publish");
    const data = mocks.updateMany.mock.calls[0][0].data;
    expect(data.breakingExpiresAt.getTime() - data.publishedAt.getTime()).toBe(24 * 60 * 60_000);
    expect(mocks.tenant).toHaveBeenCalledWith({ where: { uuid: session.tenantId }, select: { settings: true } });
  });

  it("uses the default at actual scheduled publication, not the scheduled timestamp", async () => {
    const scheduledAt = new Date("2026-10-16T09:00:00.000Z");
    mocks.findMany.mockResolvedValue([{ ...draft(true), status: ArticleStatus.SCHEDULED, scheduledAt,
      scheduledByUuid: session.userId }]);
    mocks.tenant.mockResolvedValue({ settings: { content: { breakingDurationValue: 2, breakingDurationUnit: "DAYS" } } });
    expect(await publishDueArticles(publishTime)).toBe(1);
    expect(mocks.updateMany.mock.calls[0][0].data).toMatchObject({ publishedAt: publishTime,
      breakingExpiresAt: new Date("2026-10-18T10:00:00.000Z") });
    expect(mocks.updateMany.mock.calls[0][0].where.isBreaking).toBe(true);
  });

  it("keeps non-Breaking articles without an expiration and clears expiration on unpublish", async () => {
    mocks.findFirst.mockResolvedValueOnce(draft(false)).mockResolvedValueOnce(null);
    await articleWorkflow(session, articleId, "publish");
    expect(mocks.updateMany.mock.calls[0][0].data.breakingExpiresAt).toBeNull();
    expect(mocks.tenant).not.toHaveBeenCalled();
    mocks.findFirst.mockResolvedValueOnce({ ...draft(true), status: ArticleStatus.PUBLISHED }).mockResolvedValueOnce(null);
    await articleWorkflow(session, articleId, "unpublish");
    expect(mocks.updateMany.mock.calls[1][0].data.breakingExpiresAt).toBeNull();
  });

  it("uses the latest tenant default when a Breaking article is republished", async () => {
    mocks.findFirst.mockResolvedValueOnce({ ...draft(true), status: ArticleStatus.PUBLISHED }).mockResolvedValueOnce(null)
      .mockResolvedValueOnce(draft(true)).mockResolvedValueOnce(null);
    await articleWorkflow(session, articleId, "unpublish");
    mocks.tenant.mockResolvedValue({ settings: { content: { breakingDurationValue: 2, breakingDurationUnit: "DAYS" } } });
    await articleWorkflow(session, articleId, "publish");
    const published = mocks.updateMany.mock.calls[1][0].data;
    expect(mocks.updateMany.mock.calls[0][0].data.breakingExpiresAt).toBeNull();
    expect(published.breakingExpiresAt.getTime() - published.publishedAt.getTime()).toBe(2 * 24 * 60 * 60_000);
  });
});
