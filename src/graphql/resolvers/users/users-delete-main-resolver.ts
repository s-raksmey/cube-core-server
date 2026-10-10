import type { GraphQLContext } from "@/src/graphql/context";
import { requireSession } from "@/src/graphql/helpers";
import { deleteMainTenantUser } from "@/src/modules/users/main-users.service";

export const usersDeleteMainResolver = {
  Mutation: {
    deleteMainTenantUser: async (
      _: unknown,
      args: { id: string },
      ctx: GraphQLContext,
    ) => {
      return deleteMainTenantUser(requireSession(ctx), args.id);
    },
  },
};
