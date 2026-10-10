import type { GraphQLContext } from "@/src/graphql/context";
import { requireSession } from "@/src/graphql/helpers";
import { createSubTenant } from "@/src/modules/tenants/tenant.service";

export const tenantsCreateResolver = {
  Mutation: {
    createSubTenant: async (
      _: unknown,
      args: { name: string; slug: string },
      ctx: GraphQLContext,
    ) => {
      return createSubTenant(requireSession(ctx), args);
    },
  },
};
