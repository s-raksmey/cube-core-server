import type { GraphQLContext } from "@/src/graphql/context";
import { requireSession } from "@/src/graphql/helpers";
import { listMainTenantUsers } from "@/src/modules/users/main-users.service";

export const usersListMainResolver = {
  Query: {
    mainTenantUsers: async (
      _: unknown,
      args: { search?: string; page?: number; pageSize?: number },
      ctx: GraphQLContext,
    ) => {
      return listMainTenantUsers(requireSession(ctx), args);
    },
  },
};
