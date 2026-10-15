import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ArticleStatus, TenantDomainPurpose } from "@prisma/client";

const mocks = vi.hoisted(() => ({ domain: vi.fn(), local: vi.fn(), transaction: vi.fn(), findFirst: vi.fn(), createMany: vi.fn(), updateMany: vi.fn() }));
vi.mock("@/src/modules/tenants/tenant-domain.service", () => ({ findActiveTenantByHostname: mocks.domain }));
vi.mock("@/src/modules/tenants/local-development-tenant.service", () => ({ findLocalDevelopmentTenant: mocks.local }));
vi.mock("@/src/lib/db", () => ({ prisma: { $transaction: mocks.transaction } }));

import { recordPublicWebsiteArticleView } from "@/src/modules/articles/public-article-view.service";

const tenantId = randomUUID();
const articleId = randomUUID();
const visitorId = randomUUID();
const input = { hostname: "news.example.com", articleId, visitorId };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.domain.mockResolvedValue({ uuid: tenantId });
  mocks.findFirst.mockResolvedValue({ uuid: articleId });
  mocks.createMany.mockResolvedValue({ count: 1 });
  mocks.updateMany.mockResolvedValue({ count: 1 });
  mocks.transaction.mockImplementation((work: (tx: unknown) => Promise<unknown>) => work({
    article: { findFirst: mocks.findFirst, updateMany: mocks.updateMany },
    articleView: { createMany: mocks.createMany },
  }));
});

describe("public article views", () => {
  it("records a real public view against the tenant resolved from the website hostname", async () => {
    expect(await recordPublicWebsiteArticleView(input)).toBe(true);
    expect(mocks.domain).toHaveBeenCalledWith(input.hostname, TenantDomainPurpose.WEBSITE);
    expect(mocks.findFirst).toHaveBeenCalledWith({
      where: { tenantUuid: tenantId, status: ArticleStatus.PUBLISHED, publishedAt: { lte: expect.any(Date) }, uuid: articleId },
      select: { uuid: true },
    });
    expect(mocks.createMany).toHaveBeenCalledWith({
      data: { tenantUuid: tenantId, articleUuid: articleId, visitorKey: expect.stringMatching(/^[0-9a-f]{64}$/),
        bucketStart: expect.any(Date), viewedAt: expect.any(Date) }, skipDuplicates: true,
    });
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ tenantUuid: tenantId, status: ArticleStatus.PUBLISHED, uuid: articleId }),
      data: { viewCount: { increment: 1 } },
    });
  });

  it("does not count a duplicate visitor/article/hour again", async () => {
    mocks.createMany.mockResolvedValue({ count: 0 });
    expect(await recordPublicWebsiteArticleView(input)).toBe(false);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("rejects private, unavailable, and cross-tenant article IDs", async () => {
    mocks.findFirst.mockResolvedValue(null);
    expect(await recordPublicWebsiteArticleView(input)).toBe(false);
    expect(mocks.createMany).not.toHaveBeenCalled();
    mocks.domain.mockResolvedValue(null);
    expect(await recordPublicWebsiteArticleView(input)).toBe(false);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed identifiers before touching the database", async () => {
    expect(await recordPublicWebsiteArticleView({ ...input, visitorId: "invalid" })).toBe(false);
    expect(mocks.domain).not.toHaveBeenCalled();
  });
});
