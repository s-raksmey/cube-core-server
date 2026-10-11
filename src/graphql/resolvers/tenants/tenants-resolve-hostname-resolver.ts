import {
  resolveSubTenantById,
  resolveSubTenantByHostname,
  resolveSubTenantBySlug,
} from "@/src/modules/tenants/tenant.service";
import type { TenantDomainPurpose } from "@prisma/client";

/** Public hostname lookup identifies a tenant; it grants no access to tenant data. */
export const tenantsResolveHostnameResolver = {
  Query: {
    tenantById: async (_: unknown, args: { id: string }) =>
      resolveSubTenantById(args.id),
    tenantByHostname: async (
      _: unknown,
      args: { hostname: string; purpose: TenantDomainPurpose },
    ) => resolveSubTenantByHostname(args.hostname, args.purpose),
    tenantBySlug: async (_: unknown, args: { slug: string }) =>
      resolveSubTenantBySlug(args.slug),
  },
};
