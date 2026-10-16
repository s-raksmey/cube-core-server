import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionPayload } from "@/src/lib/auth/session";

const mocks = vi.hoisted(() => ({ tenantRead: vi.fn(), tenantUpdate: vi.fn(), permission: vi.fn(), saveAsset: vi.fn(), audit: vi.fn(), lock: vi.fn() }));
vi.mock("@/src/lib/db", () => ({ prisma: { tenant: { findFirst: mocks.tenantRead, updateMany: mocks.tenantUpdate },
  $transaction: (work: (tx: unknown) => Promise<unknown>) => work({ tenant: { findFirst: mocks.tenantRead, updateMany: mocks.tenantUpdate }, $queryRaw: mocks.lock }),
} }));
vi.mock("@/src/modules/roles/role-permission.service", () => ({ requireTenantUserPermission: mocks.permission }));
vi.mock("@/src/modules/auth/audit-auth", () => ({ writeAuthAudit: mocks.audit }));
vi.mock("@/src/modules/tenants/tenant-branding.service", () => ({
  saveBrandingAsset: mocks.saveAsset,
  brandingAssetUrl: (path: string | null) => path ? `/storage/${path}` : null,
}));

import { getMySeoSettings, getPublicSeoSettingsForTenant, updateMySeoImage, updateMySeoSettings } from "@/src/modules/tenants/tenant-seo-settings.service";

const session = { audience: "TENANT_APP", tenantId: "tenant-a", userId: "user-a", role: "ADMIN" } as SessionPayload;
const input = { allowIndexing: false, metaTitle: "Default title", metaDescription: "Default description", ogTitle: "", ogDescription: "" };
const ownPath = "tenants/tenant-a/branding/open_graph_image-123.png";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.tenantRead.mockResolvedValue({ uuid: "tenant-a", settings: {}, branding: null });
  mocks.tenantUpdate.mockResolvedValue({ count: 1 });
  mocks.saveAsset.mockResolvedValue({ openGraphImageUrl: `/storage/${ownPath}` });
});

describe("tenant SEO defaults", () => {
  it("defaults to indexing allowed and empty fallback fields", async () => {
    expect(await getMySeoSettings(session)).toEqual({
      allowIndexing: true, metaTitle: "", metaDescription: "", ogTitle: "", ogDescription: "", defaultOgImageUrl: null,
    });
    expect(mocks.permission).toHaveBeenCalledWith(session, "SETTINGS_VIEW");
  });

  it("updates only the authenticated tenant and preserves other settings", async () => {
    mocks.tenantRead.mockResolvedValue({ uuid: "tenant-a", settings: { general: { siteName: "Cambo" } }, branding: null });
    expect(await updateMySeoSettings(session, input)).toMatchObject(input);
    expect(mocks.tenantUpdate).toHaveBeenCalledWith({
      where: expect.objectContaining({ uuid: "tenant-a", type: "SUB" }),
      data: { settings: { general: { siteName: "Cambo" }, seo: input } },
    });
    expect(mocks.permission).toHaveBeenCalledWith(session, "SETTINGS_UPDATE");
  });

  it("rejects other-tenant IDs and bad metadata", async () => {
    await expect(updateMySeoSettings(session, { ...input, tenantUuid: "tenant-b" }))
      .rejects.toMatchObject({ extensions: { code: "VALIDATION" } });
    await expect(updateMySeoSettings(session, { ...input, metaTitle: "x".repeat(161) }))
      .rejects.toMatchObject({ extensions: { code: "VALIDATION" } });
    expect(mocks.tenantUpdate).not.toHaveBeenCalled();
  });

  it("denies users without the Settings permission", async () => {
    mocks.permission.mockRejectedValueOnce(new Error("Forbidden"));
    await expect(updateMySeoSettings(session, input)).rejects.toThrow("Forbidden");
    expect(mocks.tenantUpdate).not.toHaveBeenCalled();
  });

  it("resolves only the current tenant's suitable public image", async () => {
    mocks.tenantRead.mockResolvedValueOnce({ uuid: "tenant-a", settings: { seo: input }, branding: { openGraphImagePath: ownPath } });
    const own = await getPublicSeoSettingsForTenant("tenant-a");
    expect(own?.defaultOgImageUrl).toBe(`/storage/${ownPath}`);
    expect(own?.allowIndexing).toBe(false);
    expect(mocks.tenantRead.mock.calls[0][0].where.uuid).toBe("tenant-a");
    mocks.tenantRead.mockResolvedValueOnce({ uuid: "tenant-a", settings: {}, branding: { openGraphImagePath: "tenants/tenant-b/branding/open_graph_image-123.png" } });
    expect((await getPublicSeoSettingsForTenant("tenant-a"))?.defaultOgImageUrl).toBeNull();
    mocks.tenantRead.mockResolvedValueOnce({ uuid: "tenant-a", settings: {}, branding: { openGraphImagePath: "tenants/tenant-a/branding/open_graph_image-123.svg" } });
    expect((await getPublicSeoSettingsForTenant("tenant-a"))?.defaultOgImageUrl).toBeNull();
  });

  it("reuses tenant-owned branding storage for a raster OG image and rejects foreign Media IDs", async () => {
    const image = { fileName: "og.png", mimeType: "image/png", contentBase64: "iVBORw0KGgo=" };
    expect(await updateMySeoImage(session, image)).toBe(`/storage/${ownPath}`);
    expect(mocks.saveAsset).toHaveBeenCalledWith("tenant-a", { asset: "OPEN_GRAPH_IMAGE", ...image });
    await expect(updateMySeoImage(session, { ...image, mediaId: "tenant-b-media" }))
      .rejects.toMatchObject({ extensions: { code: "VALIDATION" } });
    await expect(updateMySeoImage(session, { ...image, mimeType: "image/svg+xml" }))
      .rejects.toMatchObject({ extensions: { code: "VALIDATION" } });
    await expect(updateMySeoImage(session, { ...image, contentBase64: "aGVsbG8=" }))
      .rejects.toMatchObject({ extensions: { code: "VALIDATION" } });
    expect(mocks.saveAsset).toHaveBeenCalledTimes(1);
  });
});
