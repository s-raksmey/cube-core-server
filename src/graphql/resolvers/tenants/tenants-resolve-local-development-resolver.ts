import { findLocalDevelopmentTenant } from "@/src/modules/tenants/local-development-tenant.service";

/** Development-only public identity lookup; it grants no tenant access. */
export const tenantsResolveLocalDevelopmentResolver = {
  Query: {
    localDevelopmentTenant: async () => {
      const tenant = await findLocalDevelopmentTenant();
      if (!tenant) return null;
      return { id: tenant.uuid, name: tenant.name, slug: tenant.slug };
    },
  },
};
