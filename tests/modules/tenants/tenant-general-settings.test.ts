import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionPayload } from "@/src/lib/auth/session";

const mocks = vi.hoisted(() => ({
  permission: vi.fn(), tenantRead: vi.fn(), tenantUpdate: vi.fn(), transaction: vi.fn(), lock: vi.fn(), audit: vi.fn(), hostname: vi.fn(), local: vi.fn(),
}));
vi.mock("@/src/lib/db", () => ({ prisma: {
  tenant: { findFirst: mocks.tenantRead, updateMany: mocks.tenantUpdate },
  $transaction: mocks.transaction,
} }));
vi.mock("@/src/modules/auth/audit-auth", () => ({ writeAuthAudit: mocks.audit }));
vi.mock("@/src/modules/roles/role-permission.service", () => ({
  requireTenantUserPermission: mocks.permission,
}));
vi.mock("@/src/modules/tenants/tenant-domain.service", () => ({
  findActiveWebsiteTenantUuidByHostname: mocks.hostname,
}));
vi.mock("@/src/modules/tenants/local-development-tenant.service", () => ({
  findLocalDevelopmentTenant: mocks.local,
}));

import {
  getMyGeneralSettings,
  getMyWebsiteSettings,
  getPublicGeneralSettings,
  updateMyGeneralSettings,
  updateMyWebsiteSettings,
} from "@/src/modules/tenants/tenant-general-settings.service";

const session = {
  audience: "TENANT_APP", role: "ADMIN", tenantId: "tenant-a", userId: "user-a",
} as SessionPayload;
const input = {
  siteName: "Cambo Site", siteDescription: "News from Cambodia", contactEmail: "hello@example.com",
  phone: "+855 12 345 678", secondaryPhone: null, address: "Phnom Penh",
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.tenantRead.mockResolvedValue({ name: "Original", settings: {} });
  mocks.tenantUpdate.mockResolvedValue({ count: 1 });
  mocks.transaction.mockImplementation((callback) => callback({ tenant: {
    findFirst: mocks.tenantRead, updateMany: mocks.tenantUpdate,
  }, $queryRaw: mocks.lock }));
});

describe("tenant General settings", () => {
  it("reads the authenticated tenant with safe defaults for an existing record", async () => {
    const result = await getMyGeneralSettings(session);
    expect(mocks.permission).toHaveBeenCalledWith(session, "SETTINGS_VIEW");
    expect(mocks.tenantRead.mock.calls[0][0].where).toMatchObject({ uuid: "tenant-a", type: "SUB", deletedAt: null });
    expect(result).toEqual({ siteName: "Original", siteDescription: "", contactEmail: "", phone: "", secondaryPhone: null, address: "" });
  });

  it("updates only the authenticated tenant and preserves unrelated settings", async () => {
    mocks.tenantRead.mockResolvedValue({ name: "Original", settings: { other: { preserved: true } } });
    const result = await updateMyGeneralSettings(session, { ...input });
    expect(mocks.permission).toHaveBeenCalledWith(session, "SETTINGS_UPDATE");
    expect(mocks.tenantUpdate).toHaveBeenCalledWith({
      where: expect.objectContaining({ uuid: "tenant-a", type: "SUB" }),
      data: { settings: { other: { preserved: true }, general: input } },
    });
    expect(result).toEqual(input);
    expect(mocks.lock).toHaveBeenCalledTimes(1);
    expect(mocks.lock.mock.invocationCallOrder[0]).toBeLessThan(mocks.tenantRead.mock.invocationCallOrder[0]);
  });

  it("cannot select or update another tenant through input", async () => {
    await expect(updateMyGeneralSettings(session, { ...input, tenantUuid: "tenant-b" }))
      .rejects.toMatchObject({ extensions: { code: "VALIDATION" } });
    expect(mocks.tenantUpdate).not.toHaveBeenCalled();
    await getMyGeneralSettings(session);
    expect(mocks.tenantRead.mock.calls.at(-1)?.[0].where.uuid).toBe("tenant-a");
  });

  it("denies updates without SETTINGS_UPDATE", async () => {
    mocks.permission.mockRejectedValueOnce(new Error("Forbidden"));
    await expect(updateMyGeneralSettings(session, input)).rejects.toThrow("Forbidden");
    expect(mocks.tenantRead).not.toHaveBeenCalled();
    expect(mocks.tenantUpdate).not.toHaveBeenCalled();
  });

  it("returns only safe General fields for the website hostname", async () => {
    mocks.hostname.mockResolvedValue("tenant-a");
    mocks.tenantRead.mockResolvedValue({ name: "Original", settings: { general: input, secret: "private" } });
    const result = await getPublicGeneralSettings("news.example.com");
    expect(mocks.hostname).toHaveBeenCalledWith("news.example.com");
    expect(mocks.tenantRead.mock.calls[0][0].where.uuid).toBe("tenant-a");
    expect(result).toMatchObject({ ...input, website: { maintenanceMode: false, maintenanceMessage: null }, tenantUuid: "tenant-a" });
    expect(result?.seo).toMatchObject({ allowIndexing: true, defaultOgImageUrl: null });
    expect(result).not.toHaveProperty("secret");
  });

  it("validates every editable field server-side", async () => {
    await expect(updateMyGeneralSettings(session, { ...input, siteName: " " })).rejects.toMatchObject({ extensions: { code: "VALIDATION" } });
    await expect(updateMyGeneralSettings(session, { ...input, contactEmail: "bad" })).rejects.toMatchObject({ extensions: { code: "VALIDATION" } });
    await expect(updateMyGeneralSettings(session, { ...input, phone: "letters" })).rejects.toMatchObject({ extensions: { code: "VALIDATION" } });
    await expect(updateMyGeneralSettings(session, { ...input, address: "a".repeat(501) })).rejects.toMatchObject({ extensions: { code: "VALIDATION" } });
  });
});

describe("tenant Website maintenance settings", () => {
  it("defaults OFF and can still read General settings while maintenance is ON", async () => {
    expect(await getMyWebsiteSettings(session)).toEqual({ maintenanceMode: false, maintenanceMessage: null });
    mocks.tenantRead.mockResolvedValue({ name: "Original", settings: { website: { maintenanceMode: true, maintenanceMessage: "Back soon" } } });
    expect(await getMyGeneralSettings(session)).toMatchObject({ siteName: "Original" });
    expect(mocks.permission).toHaveBeenCalledWith(session, "SETTINGS_VIEW");
  });

  it("enables maintenance for the session tenant, preserving General data and auditing once", async () => {
    mocks.tenantRead.mockResolvedValue({ settings: { general: input } });
    expect(await updateMyWebsiteSettings(session, { maintenanceMode: true, maintenanceMessage: " Back soon " }))
      .toEqual({ maintenanceMode: true, maintenanceMessage: "Back soon" });
    expect(mocks.permission).toHaveBeenCalledWith(session, "SETTINGS_UPDATE");
    expect(mocks.tenantUpdate).toHaveBeenCalledWith({
      where: expect.objectContaining({ uuid: "tenant-a", type: "SUB" }),
      data: { settings: { general: input, website: { maintenanceMode: true, maintenanceMessage: "Back soon" } } },
    });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      action: "tenant.website.maintenance.enabled", tenantUuid: "tenant-a", actorUserUuid: "user-a",
    }), expect.anything());
    expect(mocks.audit).toHaveBeenCalledTimes(1);
  });

  it("disables maintenance without discarding its message and audits the transition", async () => {
    mocks.tenantRead.mockResolvedValue({ settings: { website: { maintenanceMode: true, maintenanceMessage: "Back soon" } } });
    const result = await updateMyWebsiteSettings(session, { maintenanceMode: false, maintenanceMessage: "Back soon" });
    expect(result).toEqual({ maintenanceMode: false, maintenanceMessage: "Back soon" });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "tenant.website.maintenance.disabled" }), expect.anything());
    mocks.tenantRead.mockResolvedValue({ settings: { website: result } });
    expect(await getMyWebsiteSettings(session)).toEqual(result);
  });

  it("does not audit a message-only save", async () => {
    mocks.tenantRead.mockResolvedValue({ settings: { website: { maintenanceMode: false, maintenanceMessage: "Old" } } });
    await updateMyWebsiteSettings(session, { maintenanceMode: false, maintenanceMessage: "New" });
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("isolates public maintenance by website hostname", async () => {
    mocks.hostname.mockImplementation(async (host) => host === "a.example.com" ? "tenant-a" : "tenant-b");
    mocks.tenantRead.mockImplementation(async ({ where }) => ({
      name: where.uuid === "tenant-a" ? "A" : "B",
      settings: { website: { maintenanceMode: where.uuid === "tenant-a", maintenanceMessage: "Private draft" }, secret: "never public" },
    }));
    const a = await getPublicGeneralSettings("a.example.com");
    const b = await getPublicGeneralSettings("b.example.com");
    expect(a?.website.maintenanceMode).toBe(true);
    expect(b?.website.maintenanceMode).toBe(false);
    expect(a).not.toHaveProperty("secret");
    expect(mocks.tenantRead.mock.calls.map(([args]) => args.where.uuid)).toEqual(["tenant-a", "tenant-b"]);
  });

  it("rejects cross-tenant input and users without SETTINGS_UPDATE", async () => {
    await expect(updateMyWebsiteSettings(session, { maintenanceMode: true, maintenanceMessage: null, tenantUuid: "tenant-b" }))
      .rejects.toMatchObject({ extensions: { code: "VALIDATION" } });
    mocks.permission.mockRejectedValueOnce(new Error("Forbidden"));
    await expect(updateMyWebsiteSettings(session, { maintenanceMode: true, maintenanceMessage: null })).rejects.toThrow("Forbidden");
    expect(mocks.tenantUpdate).not.toHaveBeenCalled();
  });

  it("validates both fields before writing", async () => {
    await expect(updateMyWebsiteSettings(session, { maintenanceMode: "true", maintenanceMessage: null }))
      .rejects.toMatchObject({ extensions: { code: "VALIDATION" } });
    await expect(updateMyWebsiteSettings(session, { maintenanceMode: false, maintenanceMessage: "x".repeat(1001) }))
      .rejects.toMatchObject({ extensions: { code: "VALIDATION" } });
    expect(mocks.tenantUpdate).not.toHaveBeenCalled();
  });
});
