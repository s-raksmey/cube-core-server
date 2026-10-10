import { verifyLoginTotp } from "@/src/modules/auth/totp.service";
import type { GraphQLContext } from "@/src/graphql/context";
import { requireTrustedChallengeAction } from "@/src/graphql/helpers";

export const authVerifyLoginTotpResolver = {
  Mutation: {
    verifyLoginTotp: async (
      _: unknown,
      args: { challengeToken: string; code: string },
      ctx: GraphQLContext,
    ) => {
      await requireTrustedChallengeAction(ctx, args.challengeToken);
      const result = await verifyLoginTotp(args);
      return {
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        audience: result.audience,
        user: result.user,
      };
    },
  },
};
