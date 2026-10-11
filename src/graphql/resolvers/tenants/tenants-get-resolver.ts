import type { GraphQLContext } from "@/src/graphql/context";
import { requireSession } from "@/src/graphql/helpers";
import { getSubTenant } from "@/src/modules/tenants/tenant.service";

export const tenantsGetResolver = {
  Query: {
    subTenant: async (
      _: unknown,
      args: { id: string },
      ctx: GraphQLContext,
    ) => getSubTenant(requireSession(ctx), args.id),
  },
};
