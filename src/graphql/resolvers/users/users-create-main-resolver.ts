import type { GraphQLContext } from "@/src/graphql/context";
import { requireSession } from "@/src/graphql/helpers";
import { createMainTenantUser } from "@/src/modules/users/main-users.service";

export const usersCreateMainResolver = {
  Mutation: {
    createMainTenantUser: async (
      _: unknown,
      args: { firstName: string; lastName: string; email: string },
      ctx: GraphQLContext,
    ) => {
      return createMainTenantUser(requireSession(ctx), args);
    },
  },
};
