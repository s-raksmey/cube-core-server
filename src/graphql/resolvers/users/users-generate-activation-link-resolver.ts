import type { GraphQLContext } from "@/src/graphql/context";
import { requireSession } from "@/src/graphql/helpers";
import { generateMainTenantUserActivationLink } from "@/src/modules/users/main-users.service";

export const usersGenerateActivationLinkResolver = {
  Mutation: {
    generateMainTenantUserActivationLink: async (
      _: unknown,
      args: { userId: string },
      ctx: GraphQLContext,
    ) => {
      return generateMainTenantUserActivationLink(
        requireSession(ctx),
        args.userId,
      );
    },
  },
};
