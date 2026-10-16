import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionPayload } from "@/src/lib/auth/session";

const mocks = vi.hoisted(() => ({
  permissions: vi.fn(), raw: vi.fn(),
  articleGroup: vi.fn(), articleCount: vi.fn(), articleFind: vi.fn(),
  viewCount: vi.fn(), viewGroup: vi.fn(), shareCount: vi.fn(), shareGroup: vi.fn(),
  reviewGroup: vi.fn(), tenantCount: vi.fn(), tenantFind: vi.fn(), userCount: vi.fn(), auditGroup: vi.fn(),
}));
vi.mock("@/src/modules/roles/role-permission.service", () => ({ getTenantUserPermissions: mocks.permissions }));
vi.mock("@/src/lib/db", () => ({ prisma: {
  $queryRaw: mocks.raw,
  article: { groupBy: mocks.articleGroup, count: mocks.articleCount, findMany: mocks.articleFind },
  articleView: { count: mocks.viewCount, groupBy: mocks.viewGroup },
  articleShare: { count: mocks.shareCount, groupBy: mocks.shareGroup },
  articleReview: { groupBy: mocks.reviewGroup },
  tenant: { count: mocks.tenantCount, findMany: mocks.tenantFind },
  user: { count: mocks.userCount }, auditLog: { groupBy: mocks.auditGroup },
} }));

import { getPlatformAnalytics, getTenantAnalytics } from "@/src/modules/analytics/analytics.service";

const editor: SessionPayload = { userId: randomUUID(), tenantId: randomUUID(), role: "EDITOR", audience: "TENANT_APP", sessionId: randomUUID() };
const main: SessionPayload = { ...editor, role: "SUPERADMIN", audience: "ADMIN_CONSOLE" };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.raw.mockResolvedValue([]);
  mocks.articleGroup.mockResolvedValue([]);
  mocks.articleCount.mockResolvedValue(0);
  mocks.articleFind.mockResolvedValue([]);
  mocks.viewCount.mockResolvedValue(0);
  mocks.viewGroup.mockResolvedValue([]);
  mocks.shareCount.mockResolvedValue(0);
  mocks.shareGroup.mockResolvedValue([]);
  mocks.reviewGroup.mockResolvedValue([]);
  mocks.tenantCount.mockResolvedValue(0);
  mocks.tenantFind.mockResolvedValue([]);
  mocks.userCount.mockResolvedValue(0);
  mocks.auditGroup.mockResolvedValue([]);
});

describe("analytics authorization and scope", () => {
  it("denies sessions without analytics permission", async () => {
    mocks.permissions.mockResolvedValue([]);
    await expect(getTenantAnalytics(editor, {})).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
    expect(mocks.articleGroup).not.toHaveBeenCalled();
  });

  it("scopes own analytics to the signed-in user and tenant across reads", async () => {
    mocks.permissions.mockResolvedValue(["ANALYTICS_VIEW_OWN"]);
    const result = await getTenantAnalytics(editor, { period: "LAST_7_DAYS" });
    expect(result.scope).toBe("OWN");
    expect(mocks.articleGroup).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantUuid: editor.tenantId, createdByUuid: editor.userId },
    }));
    expect(mocks.viewCount.mock.calls.every(([args]) => args.where.tenantUuid === editor.tenantId && args.where.article.createdByUuid === editor.userId)).toBe(true);
    expect(mocks.shareCount.mock.calls.every(([args]) => args.where.tenantUuid === editor.tenantId && args.where.article.createdByUuid === editor.userId)).toBe(true);
    expect(mocks.raw.mock.calls.every(([query]) => query.values.includes(editor.tenantId) && query.values.includes(editor.userId))).toBe(true);
    expect(result.authorActivity).toEqual([]);
  });

  it("uses tenant-wide permission regardless of role name and ignores client ownership", async () => {
    mocks.permissions.mockResolvedValue(["ANALYTICS_VIEW_TENANT", "ANALYTICS_VIEW_OWN"]);
    const custom = { ...editor, role: "CONTENT_MANAGER" };
    const result = await getTenantAnalytics(custom, { period: "LAST_7_DAYS", userUuid: randomUUID() });
    expect(result.scope).toBe("TENANT");
    expect(mocks.articleGroup.mock.calls[0][0].where).toEqual({ tenantUuid: editor.tenantId });
    expect(mocks.viewCount.mock.calls[0][0].where).not.toHaveProperty("article");
    const rawSql = mocks.raw.mock.calls.map(([query]) => query.sql as string);
    expect(rawSql.some((sql) => sql.includes('JOIN "article_tags"'))).toBe(true);
    expect(rawSql.some((sql) => sql.includes('JOIN "subcategories"') && sql.includes('d."slug" AS name'))).toBe(true);
  });

  it("reports current and previous engagement without dividing by zero", async () => {
    mocks.permissions.mockResolvedValue(["ANALYTICS_VIEW_OWN"]);
    mocks.articleGroup.mockResolvedValue([{ status: "PUBLISHED", _count: { _all: 2 } }]);
    mocks.viewCount.mockResolvedValueOnce(8).mockResolvedValueOnce(4);
    mocks.shareCount.mockResolvedValueOnce(3).mockResolvedValueOnce(0);
    mocks.articleCount.mockResolvedValueOnce(2).mockResolvedValueOnce(1);
    const result = await getTenantAnalytics(editor, { period: "LAST_7_DAYS" });
    expect(result.views).toEqual({ value: 8, previousValue: 4, percentChange: 100 });
    expect(result.shares).toEqual({ value: 3, previousValue: 0, percentChange: null });
    expect(result.published).toEqual({ value: 2, previousValue: 1, percentChange: 100 });
    expect(result.statusCounts.find((row) => row.name === "PUBLISHED")?.count).toBe(2);
    const [current, previous] = mocks.viewCount.mock.calls.map(([args]) => args.where.viewedAt);
    expect(previous.lt).toEqual(current.gte);
    expect(previous.gte.getTime()).toBe(current.gte.getTime() - (current.lt.getTime() - current.gte.getTime()));
  });

  it("limits platform analytics to the Main console session", async () => {
    await expect(getPlatformAnalytics(editor, {})).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
    mocks.permissions.mockResolvedValue([]);
    mocks.tenantCount.mockResolvedValueOnce(5).mockResolvedValueOnce(3).mockResolvedValueOnce(2);
    mocks.userCount.mockResolvedValue(18);
    const data = await getPlatformAnalytics(main, {});
    expect([data.totalTenants, data.activeTenants, data.suspendedTenants, data.tenantUsers]).toEqual([5, 3, 2, 18]);
    expect(mocks.tenantCount.mock.calls[0][0].where).toMatchObject({ type: "SUB", deletedAt: null });
    expect(mocks.articleFind).not.toHaveBeenCalled();
  });
});
