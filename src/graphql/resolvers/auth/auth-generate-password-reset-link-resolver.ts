import type { GraphQLContext } from "@/src/graphql/context";
import { requireSession } from "@/src/graphql/helpers";
import { generateSubTenantUserPasswordResetLink, getSubTenantUserPasswordResetLink } from "@/src/modules/auth/password-reset.service";

export const authGeneratePasswordResetLinkResolver = {
  Query: {
    tenantUserPasswordResetLink: (_: unknown, args: { userId: string }, ctx: GraphQLContext) => getSubTenantUserPasswordResetLink(requireSession(ctx), args.userId),
  },
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
