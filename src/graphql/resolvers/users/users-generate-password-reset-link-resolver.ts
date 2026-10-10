import type { GraphQLContext } from "@/src/graphql/context";
import { requireSession } from "@/src/graphql/helpers";
import { generateMainTenantUserPasswordResetLink } from "@/src/modules/auth/password-reset.service";

export const usersGeneratePasswordResetLinkResolver = {
  Mutation: {
    generateMainTenantUserPasswordResetLink: async (
      _: unknown,
      args: { userId: string },
      ctx: GraphQLContext,
    ) => {
      return generateMainTenantUserPasswordResetLink(
        requireSession(ctx),
        args.userId,
      );
    },
  },
};
