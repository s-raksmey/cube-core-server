import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionPayload } from "@/src/lib/auth/session";

const mocks = vi.hoisted(() => ({
  permission: vi.fn(),
  tenant: vi.fn(),
  branding: vi.fn(),
  saveBranding: vi.fn(),
  audit: vi.fn(),
}));
vi.mock("@/src/lib/db", () => ({ prisma: {
  tenant: { findFirst: mocks.tenant },
  tenantBranding: { upsert: mocks.branding },
} }));
vi.mock("@/src/modules/roles/role-permission.service", () => ({ requireTenantUserPermission: mocks.permission }));
vi.mock("@/src/modules/auth/audit-auth", () => ({ writeAuthAudit: mocks.audit }));

import { getTenantBranding, updateTenantBranding } from "@/src/modules/tenants/tenant-branding.service";

const session = { audience: "TENANT_APP", tenantId: "tenant-a", userId: "user-a", role: "EDITOR" } as SessionPayload;
const branding = { tenantUuid: "tenant-a", managementLogoPath: null, websiteLogoPath: null,
  faviconPath: null, publicWebsiteFaviconPath: null, openGraphImagePath: null };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.tenant.mockResolvedValue({ uuid: "tenant-a" });
  mocks.branding.mockResolvedValue(branding);
});

describe("tenant branding uses site-settings permissions", () => {
  it("requires SETTINGS_VIEW for the branding settings read", async () => {
    await expect(getTenantBranding(session, "tenant-a")).resolves.toMatchObject({ tenantId: "tenant-a" });
    expect(mocks.permission).toHaveBeenCalledWith(session, "SETTINGS_VIEW");
  });

  it("requires SETTINGS_UPDATE before changing branding", async () => {
    mocks.permission.mockRejectedValueOnce(new Error("Forbidden"));
    await expect(updateTenantBranding(session, "tenant-a", {
      asset: "WEBSITE_LOGO", fileName: "remove", mimeType: "image/png", contentBase64: null,
    })).rejects.toThrow("Forbidden");
    expect(mocks.branding).not.toHaveBeenCalled();
    expect(mocks.permission).toHaveBeenCalledWith(session, "SETTINGS_UPDATE");
  });

  it("rejects cross-tenant branding operations before database access", async () => {
    await expect(getTenantBranding(session, "tenant-b")).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
    await expect(updateTenantBranding(session, "tenant-b", {
      asset: "WEBSITE_LOGO", fileName: "remove", mimeType: "image/png", contentBase64: null,
    })).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
    expect(mocks.tenant).not.toHaveBeenCalled();
    expect(mocks.branding).not.toHaveBeenCalled();
  });
});
