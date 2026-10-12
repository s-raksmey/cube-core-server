import { findLocalDevelopmentTenant } from "@/src/modules/tenants/local-development-tenant.service";
import { brandingAssetUrl } from "@/src/modules/tenants/tenant-branding.service";

/** Development-only public identity lookup; it grants no tenant access. */
export const tenantsResolveLocalDevelopmentResolver = {
  Query: {
    localDevelopmentTenant: async () => {
      const tenant = await findLocalDevelopmentTenant();
      if (!tenant) return null;
      return { id: tenant.uuid, name: tenant.name, slug: tenant.slug, managementLogoUrl: brandingAssetUrl(tenant.branding?.managementLogoPath ?? null), websiteLogoUrl: brandingAssetUrl(tenant.branding?.websiteLogoPath ?? null), faviconUrl: brandingAssetUrl(tenant.branding?.faviconPath ?? null), publicWebsiteFaviconUrl: brandingAssetUrl(tenant.branding?.publicWebsiteFaviconPath ?? null), openGraphImageUrl: brandingAssetUrl(tenant.branding?.openGraphImagePath ?? null) };
    },
  },
};
