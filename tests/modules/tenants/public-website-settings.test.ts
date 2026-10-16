import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ domain: vi.fn(), tenant: vi.fn(), socialLinks: vi.fn() }));
vi.mock("@/src/modules/tenants/tenant-domain.service", () => ({ findActiveWebsiteTenantUuidByHostname: mocks.domain }));
vi.mock("@/src/lib/db", () => ({ prisma: {
  tenant: { findFirst: mocks.tenant }, tenantSocialLink: { findMany: mocks.socialLinks },
} }));

import { getPublicGeneralSettings } from "@/src/modules/tenants/tenant-general-settings.service";
import { getPublicSeoSettingsForTenant } from "@/src/modules/tenants/tenant-seo-settings.service";
import { listPublicSocialLinksForTenant } from "@/src/modules/tenants/tenant-social-links.service";
import { breakingExpiresAt } from "@/src/modules/tenants/tenant-content-settings.service";

const tenants = {
  "tenant-a": {
    uuid: "tenant-a", name: "Alpha", branding: null,
    socialLinks: [{ platform: "FACEBOOK", url: "https://facebook.com/alpha", sortOrder: 0 }],
    settings: { general: { siteName: "Alpha News", siteDescription: "Alpha reporting", contactEmail: "alpha@example.test",
      phone: "+10000000001", secondaryPhone: null, address: "Alpha Street" },
    website: { maintenanceMode: true, maintenanceMessage: "Alpha maintenance" },
    seo: { allowIndexing: false, metaTitle: "Alpha SEO", metaDescription: "Alpha metadata", ogTitle: "", ogDescription: "" },
    content: { breakingDurationValue: 24, breakingDurationUnit: "HOURS" } },
  },
  "tenant-b": {
    uuid: "tenant-b", name: "Beta", branding: null,
    socialLinks: [{ platform: "TELEGRAM", url: "https://t.me/beta", sortOrder: 0 }],
    settings: { general: { siteName: "Beta News", siteDescription: "Beta reporting", contactEmail: "beta@example.test",
      phone: "+10000000002", secondaryPhone: "+10000000003", address: "Beta Street" },
    website: { maintenanceMode: false, maintenanceMessage: null },
    seo: { allowIndexing: true, metaTitle: "Beta SEO", metaDescription: "Beta metadata", ogTitle: "", ogDescription: "" },
    content: { breakingDurationValue: 2, breakingDurationUnit: "DAYS" } },
  },
} as const;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.domain.mockImplementation(async (host: string) => host === "alpha.test" ? "tenant-a"
    : host === "beta.test" ? "tenant-b" : null);
  mocks.tenant.mockImplementation(async ({ where }: { where: { uuid: keyof typeof tenants } }) => tenants[where.uuid] ?? null);
  mocks.socialLinks.mockImplementation(async ({ where }: { where: { tenantUuid: string; enabled: boolean } }) => {
    if (where.tenantUuid === "tenant-a" && where.enabled) return [{ platform: "FACEBOOK", url: "https://facebook.com/alpha", sortOrder: 0 }];
    if (where.tenantUuid === "tenant-b" && where.enabled) return [{ platform: "TELEGRAM", url: "https://t.me/beta", sortOrder: 0 }];
    return [];
  });
});

describe("public website settings for separate hostnames", () => {
  it("keeps General, Maintenance, Social, SEO, and Breaking defaults within each tenant", async () => {
    const [a, b] = await Promise.all([getPublicGeneralSettings("alpha.test"), getPublicGeneralSettings("beta.test")]);
    expect(a).toMatchObject({ tenantUuid: "tenant-a", siteName: "Alpha News", contactEmail: "alpha@example.test",
      address: "Alpha Street", website: { maintenanceMode: true } });
    expect(b).toMatchObject({ tenantUuid: "tenant-b", siteName: "Beta News", contactEmail: "beta@example.test",
      secondaryPhone: "+10000000003", website: { maintenanceMode: false } });
    expect(a?.socialLinks).toEqual(tenants["tenant-a"].socialLinks);
    expect(b?.socialLinks).toEqual(tenants["tenant-b"].socialLinks);
    expect(a?.seo?.metaTitle).toBe("Alpha SEO");
    expect(b?.seo?.metaTitle).toBe("Beta SEO");
    expect(mocks.tenant.mock.calls).toHaveLength(2);
    expect(mocks.tenant.mock.calls.every(([args]) => args.select.socialLinks.where.enabled === true)).toBe(true);
    expect(await listPublicSocialLinksForTenant(a!.tenantUuid)).toEqual([{ platform: "FACEBOOK", url: "https://facebook.com/alpha", sortOrder: 0 }]);
    expect(await listPublicSocialLinksForTenant(b!.tenantUuid)).toEqual([{ platform: "TELEGRAM", url: "https://t.me/beta", sortOrder: 0 }]);
    expect((await getPublicSeoSettingsForTenant(a!.tenantUuid))?.metaTitle).toBe("Alpha SEO");
    expect((await getPublicSeoSettingsForTenant(b!.tenantUuid))?.metaTitle).toBe("Beta SEO");
    const publishedAt = new Date("2026-10-16T10:00:00Z");
    expect(breakingExpiresAt(publishedAt, tenants["tenant-a"].settings)).toEqual(new Date("2026-10-17T10:00:00Z"));
    expect(breakingExpiresAt(publishedAt, tenants["tenant-b"].settings)).toEqual(new Date("2026-10-18T10:00:00Z"));
    expect(mocks.tenant.mock.calls.map(([args]) => args.where.uuid)).toEqual(["tenant-a", "tenant-b", "tenant-a", "tenant-b"]);
    expect(mocks.socialLinks.mock.calls.every(([args]) => args.where.enabled === true)).toBe(true);
  });

  it("returns no config for an unrelated hostname", async () => {
    expect(await getPublicGeneralSettings("unknown.test")).toBeNull();
    expect(mocks.tenant).not.toHaveBeenCalled();
  });
});
