import type { GraphQLContext } from "@/src/graphql/context";
import { requireSession } from "@/src/graphql/helpers";
import {
  generateMainTenantUserActivationLink,
  getMainTenantUserActivationLink,
} from "@/src/modules/users/main-users.service";

export const usersGenerateActivationLinkResolver = {
  Query: {
    mainTenantUserActivationLink: async (
      _: unknown,
      args: { userId: string },
      ctx: GraphQLContext,
    ) => getMainTenantUserActivationLink(requireSession(ctx), args.userId),
  },
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
