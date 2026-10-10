import type { GraphQLContext } from "@/src/graphql/context";
import { requireSession } from "@/src/graphql/helpers";
import { listSubTenants } from "@/src/modules/tenants/tenant.service";

export const tenantsListResolver = {
  Query: {
    subTenants: async (
      _: unknown,
      args: { search?: string; page?: number; pageSize?: number },
      ctx: GraphQLContext,
    ) => {
      return listSubTenants(requireSession(ctx), args);
    },
  },
};
