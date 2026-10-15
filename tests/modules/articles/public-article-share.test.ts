import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ArticleSharePlatform, ArticleStatus, TenantDomainPurpose } from "@prisma/client";

const mocks = vi.hoisted(() => ({ domain: vi.fn(), local: vi.fn(), transaction: vi.fn(), findFirst: vi.fn(), createMany: vi.fn(), updateMany: vi.fn() }));
vi.mock("@/src/modules/tenants/tenant-domain.service", () => ({ findActiveTenantByHostname: mocks.domain }));
vi.mock("@/src/modules/tenants/local-development-tenant.service", () => ({ findLocalDevelopmentTenant: mocks.local }));
vi.mock("@/src/lib/db", () => ({ prisma: { $transaction: mocks.transaction } }));

import { recordPublicWebsiteArticleShare } from "@/src/modules/articles/public-article-share.service";

const tenantId = randomUUID();
const articleId = randomUUID();
const visitorId = randomUUID();
const input = { hostname: "news.example.com", articleId, visitorId, platform: ArticleSharePlatform.FACEBOOK };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.domain.mockResolvedValue({ uuid: tenantId });
  mocks.findFirst.mockResolvedValue({ uuid: articleId });
  mocks.createMany.mockResolvedValue({ count: 1 });
  mocks.updateMany.mockResolvedValue({ count: 1 });
  mocks.transaction.mockImplementation((work: (tx: unknown) => Promise<unknown>) => work({
    article: { findFirst: mocks.findFirst, updateMany: mocks.updateMany },
    articleShare: { createMany: mocks.createMany },
  }));
});

describe("public article shares", () => {
  it("records a Facebook share for the public article in the resolved website tenant", async () => {
    expect(await recordPublicWebsiteArticleShare(input)).toBe(true);
    expect(mocks.domain).toHaveBeenCalledWith(input.hostname, TenantDomainPurpose.WEBSITE);
    expect(mocks.findFirst).toHaveBeenCalledWith({
      where: { tenantUuid: tenantId, status: ArticleStatus.PUBLISHED, publishedAt: { lte: expect.any(Date) }, uuid: articleId },
      select: { uuid: true },
    });
    expect(mocks.createMany).toHaveBeenCalledWith({
      data: { tenantUuid: tenantId, articleUuid: articleId, platform: ArticleSharePlatform.FACEBOOK,
        visitorKey: expect.stringMatching(/^[0-9a-f]{64}$/), bucketStart: expect.any(Date), sharedAt: expect.any(Date) },
      skipDuplicates: true,
    });
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ tenantUuid: tenantId, status: ArticleStatus.PUBLISHED, uuid: articleId }),
      data: { shareCount: { increment: 1 } },
    });
  });

  it("accepts only the supported platform values", async () => {
    for (const platform of [ArticleSharePlatform.TELEGRAM, ArticleSharePlatform.COPY_LINK, ArticleSharePlatform.NATIVE]) {
      expect(await recordPublicWebsiteArticleShare({ ...input, platform })).toBe(true);
    }
    expect(mocks.createMany.mock.calls.map(([args]) => args.data.platform)).toEqual([
      ArticleSharePlatform.TELEGRAM, ArticleSharePlatform.COPY_LINK, ArticleSharePlatform.NATIVE,
    ]);
    expect(await recordPublicWebsiteArticleShare({ ...input, platform: "X" })).toBe(false);
    expect(mocks.createMany).toHaveBeenCalledTimes(3);
  });

  it("does not count a rapid duplicate again", async () => {
    mocks.createMany.mockResolvedValue({ count: 0 });
    expect(await recordPublicWebsiteArticleShare(input)).toBe(false);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("rejects non-public and cross-tenant articles", async () => {
    mocks.findFirst.mockResolvedValue(null);
    expect(await recordPublicWebsiteArticleShare(input)).toBe(false);
    expect(mocks.createMany).not.toHaveBeenCalled();
    mocks.domain.mockResolvedValue(null);
    expect(await recordPublicWebsiteArticleShare(input)).toBe(false);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
  });

  it("ignores browser-supplied counts and rejects invalid IDs", async () => {
    expect(await recordPublicWebsiteArticleShare({ ...input, visitorId: "invalid" })).toBe(false);
    expect(await recordPublicWebsiteArticleShare({ ...input, articleId: "invalid" })).toBe(false);
    expect(mocks.domain).not.toHaveBeenCalled();
    expect(await recordPublicWebsiteArticleShare({ ...input, shareCount: 5000 })).toBe(true);
    expect(mocks.createMany.mock.calls[0][0].data).not.toHaveProperty("shareCount");
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { shareCount: { increment: 1 } } }));
  });
});
