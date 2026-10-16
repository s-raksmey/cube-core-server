import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionPayload } from "@/src/lib/auth/session";

const mocks = vi.hoisted(() => ({
  permissions: vi.fn(), tenant: vi.fn(), membershipCount: vi.fn(), membershipFind: vi.fn(),
  auditFind: vi.fn(), articleGroup: vi.fn(), raw: vi.fn(),
}));
vi.mock("@/src/modules/roles/role-permission.service", () => ({ getTenantUserPermissions: mocks.permissions }));
vi.mock("@/src/lib/db", () => ({ prisma: {
  tenant: { findUnique: mocks.tenant },
  tenantMembership: { count: mocks.membershipCount, findMany: mocks.membershipFind },
  auditLog: { findMany: mocks.auditFind },
  article: { groupBy: mocks.articleGroup },
  $queryRaw: mocks.raw,
} }));

import { getTenantDashboard } from "@/src/modules/dashboard/dashboard.service";

const session: SessionPayload = {
  userId: randomUUID(), tenantId: randomUUID(), role: "EDITOR",
  audience: "TENANT_APP", sessionId: randomUUID(),
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.tenant.mockResolvedValue({ uuid: session.tenantId, name: "News", slug: "news", type: "SUB", status: "ACTIVE", createdAt: new Date() });
  mocks.membershipCount.mockResolvedValue(0);
  mocks.membershipFind.mockResolvedValue([]);
  mocks.auditFind.mockResolvedValue([]);
  mocks.articleGroup.mockResolvedValue([{ status: "PUBLISHED", _count: { _all: 2 } }, { status: "DRAFT", _count: { _all: 1 } }]);
  mocks.raw.mockResolvedValue([]);
});

describe("tenant dashboard article metrics", () => {
  it("shows current statuses and publishing activity for the editor's own articles", async () => {
    mocks.permissions.mockResolvedValue(["ANALYTICS_VIEW_OWN"]);
    const month = new Date().toISOString().slice(0, 7);
    mocks.raw.mockResolvedValueOnce([{ month, count: 2 }]).mockResolvedValueOnce([
      { source: "VIEWS", month, count: 9 },
      { source: "SHARES", month, count: 3 },
    ]);

    const result = await getTenantDashboard(session);

    expect(mocks.articleGroup).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantUuid: session.tenantId, createdByUuid: session.userId },
    }));
    expect(mocks.raw.mock.calls.every(([query]) => query.values.includes(session.userId))).toBe(true);
    expect(result.publishedContent).toBe(2);
    expect(result.contentActivityByMonth.at(-1)).toEqual({ month, count: 2 });
    expect(result.viewsByMonth.at(-1)).toEqual({ month, count: 9 });
    expect(result.sharesByMonth.at(-1)).toEqual({ month, count: 3 });
    expect(result.contentByStatus).toEqual(expect.arrayContaining([
      { status: "PUBLISHED", count: 2 }, { status: "DRAFT", count: 1 },
    ]));
  });

  it("does not read article metrics without analytics permission", async () => {
    mocks.permissions.mockResolvedValue([]);
    const result = await getTenantDashboard(session);
    expect(mocks.articleGroup).not.toHaveBeenCalled();
    expect(mocks.raw).not.toHaveBeenCalled();
    expect(result.contentByStatus).toEqual([]);
  });

  it("uses the full tenant only with tenant-wide analytics permission", async () => {
    mocks.permissions.mockResolvedValue(["ANALYTICS_VIEW_TENANT"]);
    await getTenantDashboard(session);
    expect(mocks.articleGroup.mock.calls[0][0].where).toEqual({ tenantUuid: session.tenantId });
    expect(mocks.raw.mock.calls.every(([query]) => !query.values.includes(session.userId))).toBe(true);
  });
});
