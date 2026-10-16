import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionPayload } from "@/src/lib/auth/session";

const mocks = vi.hoisted(() => ({
  permission: vi.fn(), tenantRead: vi.fn(), linkFind: vi.fn(), linkDelete: vi.fn(), linkUpsert: vi.fn(),
  transaction: vi.fn(), audit: vi.fn(), lock: vi.fn(),
}));
vi.mock("@/src/lib/db", () => ({ prisma: {
  tenant: { findFirst: mocks.tenantRead },
  tenantSocialLink: { findMany: mocks.linkFind },
  $transaction: mocks.transaction,
} }));
vi.mock("@/src/modules/roles/role-permission.service", () => ({ requireTenantUserPermission: mocks.permission }));
vi.mock("@/src/modules/auth/audit-auth", () => ({ writeAuthAudit: mocks.audit }));

import { listMySocialLinks, listPublicSocialLinksForTenant, updateMySocialLinks } from "@/src/modules/tenants/tenant-social-links.service";

const session = { audience: "TENANT_APP", tenantId: "tenant-a", userId: "user-a", role: "ADMIN" } as SessionPayload;
const facebook = { platform: "FACEBOOK", url: "https://www.facebook.com/CamboSite", enabled: true, sortOrder: 2 };
const telegram = { platform: "TELEGRAM", url: "https://t.me/CamboSite", enabled: false, sortOrder: 1 };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.tenantRead.mockResolvedValue({ uuid: "tenant-a" });
  mocks.linkFind.mockResolvedValue([]);
  mocks.transaction.mockImplementation((callback) => callback({ tenant: { findFirst: mocks.tenantRead }, $queryRaw: mocks.lock, tenantSocialLink: {
    deleteMany: mocks.linkDelete, upsert: mocks.linkUpsert, findMany: mocks.linkFind,
  } }));
});

describe("tenant social links", () => {
  it("accepts valid platform HTTPS URLs and saves only under the session tenant", async () => {
    await updateMySocialLinks(session, [facebook, telegram]);
    expect(mocks.permission).toHaveBeenCalledWith(session, "SETTINGS_UPDATE");
    expect(mocks.linkUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantUuid_platform: { tenantUuid: "tenant-a", platform: "FACEBOOK" } },
      create: { tenantUuid: "tenant-a", ...facebook },
    }));
    expect(mocks.linkUpsert).toHaveBeenCalledTimes(2);
    expect(mocks.lock.mock.invocationCallOrder[0]).toBeLessThan(mocks.linkDelete.mock.invocationCallOrder[0]);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "tenant.social_links.updated", tenantUuid: "tenant-a" }), expect.anything());
  });

  it("rejects malformed, non-HTTPS, wrong-domain and credential URLs", async () => {
    for (const url of ["not a URL", "http://facebook.com/page", "https://fakefacebook.com/page", "https://user:pass@facebook.com/page"]) {
      await expect(updateMySocialLinks(session, [{ ...facebook, url }])).rejects.toMatchObject({ extensions: { code: "VALIDATION" } });
    }
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("requires a URL for an enabled link and rejects duplicate platforms or tenant IDs", async () => {
    await expect(updateMySocialLinks(session, [{ ...facebook, url: "" }])).rejects.toMatchObject({ extensions: { code: "VALIDATION" } });
    await expect(updateMySocialLinks(session, [facebook, facebook])).rejects.toMatchObject({ extensions: { code: "VALIDATION" } });
    await expect(updateMySocialLinks(session, [{ ...facebook, tenantUuid: "tenant-b" }])).rejects.toMatchObject({ extensions: { code: "VALIDATION" } });
  });

  it("removes blank disabled links for this tenant only", async () => {
    await updateMySocialLinks(session, [{ ...facebook, url: "", enabled: false, sortOrder: 0 }]);
    expect(mocks.linkDelete).toHaveBeenCalledWith({ where: { tenantUuid: "tenant-a" } });
    expect(mocks.linkUpsert).not.toHaveBeenCalled();
  });

  it("returns management links scoped to the authenticated tenant", async () => {
    await listMySocialLinks(session);
    expect(mocks.permission).toHaveBeenCalledWith(session, "SETTINGS_VIEW");
    expect(mocks.linkFind).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantUuid: "tenant-a" } }));
  });

  it("returns only enabled links publicly in sort order", async () => {
    mocks.linkFind.mockResolvedValue([{ platform: "YOUTUBE", url: "https://youtube.com/@cambo", sortOrder: 0 }, { platform: "FACEBOOK", url: facebook.url, sortOrder: 2 }]);
    const result = await listPublicSocialLinksForTenant("tenant-a");
    expect(result.map((link: { platform: string }) => link.platform)).toEqual(["YOUTUBE", "FACEBOOK"]);
    expect(mocks.linkFind).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ tenantUuid: "tenant-a", enabled: true }),
      select: { platform: true, url: true, sortOrder: true },
      orderBy: [{ sortOrder: "asc" }, { platform: "asc" }],
    }));
  });

  it("cannot read or update another tenant via the management API", async () => {
    await listMySocialLinks(session);
    await updateMySocialLinks(session, [facebook]);
    expect(mocks.linkFind.mock.calls.every(([args]) => args.where.tenantUuid === "tenant-a")).toBe(true);
    expect(mocks.linkDelete.mock.calls[0][0].where.tenantUuid).toBe("tenant-a");
    expect(mocks.linkUpsert.mock.calls[0][0].where.tenantUuid_platform.tenantUuid).toBe("tenant-a");
  });

  it("denies reads or updates without the matching Settings permission", async () => {
    mocks.permission.mockRejectedValueOnce(new Error("Forbidden"));
    await expect(listMySocialLinks(session)).rejects.toThrow("Forbidden");
    mocks.permission.mockRejectedValueOnce(new Error("Forbidden"));
    await expect(updateMySocialLinks(session, [facebook])).rejects.toThrow("Forbidden");
    expect(mocks.linkFind).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
