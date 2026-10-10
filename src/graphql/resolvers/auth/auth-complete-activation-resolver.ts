import { completeActivationCredentials } from "@/src/modules/auth/activation.service";
import type { GraphQLContext } from "@/src/graphql/context";
import { requireTrustedAuthAction } from "@/src/graphql/helpers";

export const authCompleteActivationResolver = {
  Mutation: {
    completeActivation: async (
      _: unknown,
      args: {
        token: string;
        username: string;
        password: string;
        confirmPassword: string;
      },
      ctx: GraphQLContext,
    ) => {
      requireTrustedAuthAction(ctx, "ADMIN_CONSOLE");
      return completeActivationCredentials(args);
    },
  },
};
