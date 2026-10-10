import type { GraphQLContext } from "@/src/graphql/context";
import { requireSession } from "@/src/graphql/helpers";
import { deleteTenantUser } from "@/src/modules/tenants/tenant.service";

export const tenantsDeleteUserResolver = {
  Mutation: {
    deleteTenantUser: async (
      _: unknown,
      args: { id: string },
      ctx: GraphQLContext,
    ) => deleteTenantUser(requireSession(ctx), args.id),
  },
};
