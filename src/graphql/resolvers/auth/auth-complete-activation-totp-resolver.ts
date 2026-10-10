import { completeActivationTotp } from "@/src/modules/auth/activation.service";

export const authCompleteActivationTotpResolver = {
  Mutation: {
    completeActivationTotp: async (
      _: unknown,
      args: {
        challengeToken: string;
        code: string;
        activationToken: string;
      },
    ) => {
      return completeActivationTotp(args);
    },
  },
};
