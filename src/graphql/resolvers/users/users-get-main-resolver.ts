import type { GraphQLContext } from "@/src/graphql/context";
import { requireSession } from "@/src/graphql/helpers";
import { getMainTenantUser } from "@/src/modules/users/main-user-query.service";

export const usersGetMainResolver = {
  Query: {
    mainTenantUser: async (
      _: unknown,
      args: { id: string },
      ctx: GraphQLContext,
    ) => {
      return getMainTenantUser(requireSession(ctx), args.id);
    },
  },
};
