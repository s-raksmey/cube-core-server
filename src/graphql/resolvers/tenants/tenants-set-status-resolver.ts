import { TenantStatus } from "@prisma/client";
import type { GraphQLContext } from "@/src/graphql/context";
import { requireSession } from "@/src/graphql/helpers";
import { setSubTenantStatus } from "@/src/modules/tenants/tenant.service";

export const tenantsSetStatusResolver = {
  Mutation: {
    setSubTenantStatus: async (
      _: unknown,
      args: { tenantId: string; status: TenantStatus },
      ctx: GraphQLContext,
    ) => {
      return setSubTenantStatus(requireSession(ctx), args);
    },
  },
};
