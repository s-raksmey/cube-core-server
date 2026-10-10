import { completeActivationCredentials } from "@/src/modules/auth/activation.service";

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
    ) => {
      return completeActivationCredentials(args);
    },
  },
};
