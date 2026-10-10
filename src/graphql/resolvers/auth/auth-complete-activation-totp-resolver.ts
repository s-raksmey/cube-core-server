import { completeActivationTotp } from "@/src/modules/auth/activation.service";
import type { GraphQLContext } from "@/src/graphql/context";
import { requireTrustedChallengeAction } from "@/src/graphql/helpers";

export const authCompleteActivationTotpResolver = {
  Mutation: {
    completeActivationTotp: async (
      _: unknown,
      args: {
        challengeToken: string;
        code: string;
      },
      ctx: GraphQLContext,
    ) => {
      await requireTrustedChallengeAction(ctx, args.challengeToken);
      return completeActivationTotp(args);
    },
  },
};
