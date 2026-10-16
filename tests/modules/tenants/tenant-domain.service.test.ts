import { beforeEach, describe, expect, it, vi } from "vitest";
import { TenantDomainPurpose, TenantDomainStatus } from "@prisma/client";

const { findFirst, tenantFindFirst, resolveTxt } = vi.hoisted(() => ({ findFirst: vi.fn(), tenantFindFirst: vi.fn(), resolveTxt: vi.fn() }));
vi.mock("node:dns/promises", () => ({ resolveTxt }));
vi.mock("@/src/lib/db", () => ({
  prisma: { tenantDomain: { findFirst }, tenant: { findFirst: tenantFindFirst } },
}));

import {
  findActiveTenantById,
  findActiveTenantByHostname,
  findActiveWebsiteTenantUuidByHostname,
  findActiveTenantBySlug,
  hasDomainVerificationRecord,
  normalizeTenantHostname,
} from "@/src/modules/tenants/tenant-domain.service";

beforeEach(() => { findFirst.mockReset(); tenantFindFirst.mockReset(); resolveTxt.mockReset(); });

describe("normalizeTenantHostname", () => {
  it("normalizes case, a trailing dot, and internationalized names", () => {
    expect(normalizeTenantHostname("  EXAMPLE.COM. ")).toBe("example.com");
    expect(normalizeTenantHostname("bücher.example")).toBe("xn--bcher-kva.example");
  });

  it.each([
    "https://example.com",
    "example.com:443",
    "example.com/path",
    "192.0.2.1",
    "bad..example",
    "-bad.example",
  ])("rejects invalid hostname %s", (hostname) => {
    expect(normalizeTenantHostname(hostname)).toBeNull();
  });

  it("allows localhost for local development", () => {
    expect(normalizeTenantHostname("LOCALHOST")).toBe("localhost");
  });

  it("resolves only active sub-tenants and normalizes the lookup hostname", async () => {
    findFirst.mockResolvedValue(null);

    await findActiveTenantByHostname(" TENANT.EXAMPLE. ", TenantDomainPurpose.MANAGEMENT);

    expect(findFirst).toHaveBeenCalledWith({
      where: {
        hostname: "tenant.example",
        purpose: TenantDomainPurpose.MANAGEMENT,
        status: TenantDomainStatus.ACTIVE,
        tenant: {
          type: "SUB",
          status: "ACTIVE",
          deletedAt: null,
        },
      },
      select: expect.objectContaining({ tenant: expect.any(Object) }),
    });
  });

  it("does not query the database for an invalid hostname", async () => {
    await expect(
      findActiveTenantByHostname("https://tenant.example", TenantDomainPurpose.WEBSITE),
    ).resolves.toBeNull();
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("resolves only the website tenant key for public Settings", async () => {
    findFirst.mockResolvedValue({ tenantUuid: "tenant-a" });
    await expect(findActiveWebsiteTenantUuidByHostname(" SITE.EXAMPLE. ")).resolves.toBe("tenant-a");
    expect(findFirst).toHaveBeenCalledWith({
      where: { hostname: "site.example", purpose: TenantDomainPurpose.WEBSITE,
        status: TenantDomainStatus.ACTIVE,
        tenant: { type: "SUB", status: "ACTIVE", deletedAt: null } },
      select: { tenantUuid: true },
    });
  });

  it("resolves only active sub-tenants by normalized slug and returns safe identity fields", async () => {
    tenantFindFirst.mockResolvedValue({ uuid: "tenant-uuid", name: "Cam Bo Site", slug: "cam-bo-site", type: "SUB", status: "ACTIVE" });
    await expect(findActiveTenantBySlug(" Cam-Bo-Site ")).resolves.toMatchObject({
      name: "Cam Bo Site",
      slug: "cam-bo-site",
    });
    expect(tenantFindFirst).toHaveBeenCalledWith({
      where: { slug: "cam-bo-site", type: "SUB", status: "ACTIVE", deletedAt: null },
      select: expect.objectContaining({ uuid: true, name: true, slug: true, type: true, status: true,
        branding: expect.objectContaining({ select: expect.objectContaining({ websiteLogoPath: true, openGraphImagePath: true }) }),
      }),
    });
  });

  it.each([
    ["11111111-1111-4111-8111-111111111111", "Cambo Site", "cambo-site"],
    ["22222222-2222-4222-8222-222222222222", "News Website", "news-website"],
  ])("resolves the requested active SUB tenant UUID to its safe branding", async (uuid, name, slug) => {
    tenantFindFirst.mockResolvedValue({ uuid, name, slug, type: "SUB", status: "ACTIVE" });
    await expect(findActiveTenantById(uuid)).resolves.toMatchObject({
      name,
      slug,
      type: "SUB",
      status: "ACTIVE",
    });
    expect(tenantFindFirst).toHaveBeenCalledWith({
      where: {
        uuid,
        type: "SUB",
        status: "ACTIVE",
        deletedAt: null,
      },
      select: expect.objectContaining({ uuid: true, name: true, slug: true, type: true, status: true,
        branding: expect.objectContaining({ select: expect.objectContaining({ websiteLogoPath: true, openGraphImagePath: true }) }),
      }),
    });
  });

  it.each([
    ["unknown UUID", null],
    ["inactive tenant", null],
    ["MAIN tenant", null],
  ])("returns unavailable for %s", async (_label, result) => {
    tenantFindFirst.mockResolvedValue(result);
    await expect(findActiveTenantById("11111111-1111-4111-8111-111111111111")).resolves.toBeNull();
  });

  it("does not query the database for an invalid UUID", async () => {
    await expect(findActiveTenantById("not-a-uuid")).resolves.toBeNull();
    expect(tenantFindFirst).not.toHaveBeenCalled();
  });

  it("does not query for an invalid local tenant slug", async () => {
    await expect(findActiveTenantBySlug("../main")).resolves.toBeNull();
    expect(tenantFindFirst).not.toHaveBeenCalled();
  });

  it("returns no tenant when the selected slug is not active", async () => {
    tenantFindFirst.mockResolvedValue(null);
    await expect(findActiveTenantBySlug("disabled-tenant")).resolves.toBeNull();
  });

  it("accepts only an exact ownership TXT challenge", async () => {
    resolveTxt.mockResolvedValue([["cube-core-verification=proof", "-fragment"]]);
    await expect(hasDomainVerificationRecord("tenant.example", "proof-fragment")).resolves.toBe(true);
    resolveTxt.mockResolvedValue([["cube-core-verification=other"]]);
    await expect(hasDomainVerificationRecord("tenant.example", "proof")).resolves.toBe(false);
    expect(resolveTxt).toHaveBeenCalledWith("_cube-core-verification.tenant.example");
  });

  it("treats missing TXT records as not yet verified", async () => {
    resolveTxt.mockRejectedValue(new Error("ENODATA"));
    await expect(hasDomainVerificationRecord("tenant.example", "proof")).resolves.toBe(false);
  });

});
