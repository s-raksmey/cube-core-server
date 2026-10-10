import { completePasswordReset } from "@/src/modules/auth/password-reset.service";

export const authCompletePasswordResetResolver = {
  Mutation: {
    completePasswordReset: async (
      _: unknown,
      args: {
        token: string;
        password: string;
        confirmPassword: string;
      },
    ) => {
      return completePasswordReset({
        token: args.token,
        password: args.password,
        confirmPassword: args.confirmPassword,
      });
    },
  },
};
