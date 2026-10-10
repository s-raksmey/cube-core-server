import type { GraphQLContext } from "@/src/graphql/context";
import { requireSession } from "@/src/graphql/helpers";
import { generateSubTenantUserPasswordResetLink } from "@/src/modules/auth/password-reset.service";

export const authGeneratePasswordResetLinkResolver = {
  Mutation: {
    generatePasswordResetLink: async (
      _: unknown,
      args: { userId: string },
      ctx: GraphQLContext,
    ) => {
      return generateSubTenantUserPasswordResetLink(
        requireSession(ctx),
        args.userId,
      );
    },
  },
};
