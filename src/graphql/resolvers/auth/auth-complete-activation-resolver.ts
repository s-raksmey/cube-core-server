import { completeActivationCredentials } from "@/src/modules/auth/activation.service";
import type { GraphQLContext } from "@/src/graphql/context";
import { forbidden } from "@/src/lib/errors";

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
      const trustedAudience = ctx.trustedAuthAudience;
      if (!trustedAudience) {
        throw forbidden(
          "This authentication operation is available only to the trusted application server",
        );
      }
      return completeActivationCredentials({ ...args, trustedAudience });
    },
  },
};
