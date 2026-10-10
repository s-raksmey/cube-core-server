import type { GraphQLContext } from "@/src/graphql/context";
import { requireSession } from "@/src/graphql/helpers";
import { listTenantUsers } from "@/src/modules/tenants/tenant.service";

export const tenantsUsersResolver = {
  Query: {
    tenantUsers: async (
      _: unknown,
      args: { search?: string; page?: number; pageSize?: number },
      ctx: GraphQLContext,
    ) => {
      return listTenantUsers(requireSession(ctx), args);
    },
  },
};
