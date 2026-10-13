import { TenantDomainPurpose } from "@prisma/client";
import type { GraphQLContext } from "@/src/graphql/context";
import { requireSession } from "@/src/graphql/helpers";
import {
  activateTenantDomain,
  checkTenantDomainVerification,
  startTenantDomainVerification,
} from "@/src/modules/tenants/tenant-domain-management.service";

export const tenantsDomainsResolver = {
  Mutation: {
    startTenantDomainVerification: async (
      _: unknown,
      args: { tenantId: string; purpose: TenantDomainPurpose },
      ctx: GraphQLContext,
    ) => startTenantDomainVerification(requireSession(ctx), args.tenantId, args.purpose),
    checkTenantDomainVerification: async (
      _: unknown,
      args: { tenantId: string; purpose: TenantDomainPurpose },
      ctx: GraphQLContext,
    ) => checkTenantDomainVerification(requireSession(ctx), args.tenantId, args.purpose),
    activateTenantDomain: async (
      _: unknown,
      args: { tenantId: string; purpose: TenantDomainPurpose; confirmHttpsAndRouting: boolean },
      ctx: GraphQLContext,
    ) => activateTenantDomain(
      requireSession(ctx),
      args.tenantId,
      args.purpose,
      args.confirmHttpsAndRouting,
    ),
  },
};
