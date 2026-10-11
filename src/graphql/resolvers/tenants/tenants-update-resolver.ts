import type { GraphQLContext } from "@/src/graphql/context";
import { requireSession } from "@/src/graphql/helpers";
import { updateSubTenant } from "@/src/modules/tenants/tenant.service";

export const tenantsUpdateResolver = {
  Mutation: {
    updateSubTenant: async (
      _: unknown,
      args: {
        tenantId: string;
        input: {
          name: string;
          slug: string;
          managementDomain?: string | null;
          websiteDomain?: string | null;
        };
      },
      ctx: GraphQLContext,
    ) => updateSubTenant(requireSession(ctx), args.tenantId, args.input),
  },
};
