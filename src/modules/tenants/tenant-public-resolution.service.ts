import {
  TenantDomainPurpose,
  TenantDomainStatus,
  TenantType,
} from "@prisma/client";
import {
  findActiveTenantByHostname,
  findActiveTenantById,
  findActiveTenantBySlug,
} from "@/src/modules/tenants/tenant-domain.service";
import { brandingAssetUrl } from "@/src/modules/tenants/tenant-branding.service";
export async function resolveSubTenantByHostname(
  hostname: string,
  purpose: TenantDomainPurpose,
) {
  const tenant = await findActiveTenantByHostname(hostname, purpose);
  if (!tenant) return null;
  const managementDomain =
    tenant.domains.find((domain) => domain.purpose === "MANAGEMENT" && domain.status === TenantDomainStatus.ACTIVE)?.hostname ?? null;
  const websiteDomain =
    tenant.domains.find((domain) => domain.purpose === "WEBSITE" && domain.status === TenantDomainStatus.ACTIVE)?.hostname ?? null;
  return {
    id: tenant.uuid,
    name: tenant.name,
    slug: tenant.slug,
    type: tenant.type,
    status: tenant.status,
    managementDomain,
    websiteDomain,
    managementLogoUrl: brandingAssetUrl(tenant.branding?.managementLogoPath ?? null),
    websiteLogoUrl: brandingAssetUrl(tenant.branding?.websiteLogoPath ?? null),
    faviconUrl: brandingAssetUrl(tenant.branding?.faviconPath ?? null),
    publicWebsiteFaviconUrl: brandingAssetUrl(tenant.branding?.publicWebsiteFaviconPath ?? null),
    openGraphImageUrl: brandingAssetUrl(tenant.branding?.openGraphImagePath ?? null),
  };
}

export async function resolveSubTenantBySlug(slug: string) {
  const tenant = await findActiveTenantBySlug(slug);
  if (!tenant || tenant.type !== TenantType.SUB) return null;
  return { id: tenant.uuid, name: tenant.name, slug: tenant.slug, managementLogoUrl: brandingAssetUrl(tenant.branding?.managementLogoPath ?? null), websiteLogoUrl: brandingAssetUrl(tenant.branding?.websiteLogoPath ?? null), faviconUrl: brandingAssetUrl(tenant.branding?.faviconPath ?? null), publicWebsiteFaviconUrl: brandingAssetUrl(tenant.branding?.publicWebsiteFaviconPath ?? null), openGraphImageUrl: brandingAssetUrl(tenant.branding?.openGraphImagePath ?? null) };
}

export async function resolveSubTenantById(id: string) {
  const tenant = await findActiveTenantById(id);
  if (!tenant || tenant.type !== TenantType.SUB) return null;
  return { id: tenant.uuid, name: tenant.name, slug: tenant.slug, managementLogoUrl: brandingAssetUrl(tenant.branding?.managementLogoPath ?? null), websiteLogoUrl: brandingAssetUrl(tenant.branding?.websiteLogoPath ?? null), faviconUrl: brandingAssetUrl(tenant.branding?.faviconPath ?? null), publicWebsiteFaviconUrl: brandingAssetUrl(tenant.branding?.publicWebsiteFaviconPath ?? null), openGraphImageUrl: brandingAssetUrl(tenant.branding?.openGraphImagePath ?? null) };
}

