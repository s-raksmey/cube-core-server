import { completePasswordReset } from "@/src/modules/auth/password-reset.service";

export const authCompletePasswordResetResolver = {
  Mutation: {
    completePasswordReset: async (
      _: unknown,
      args: {
        token: string;
        firstName?: string | null;
        lastName?: string | null;
        fullName?: string | null;
        password: string;
        confirmPassword: string;
      },
    ) => {
      return completePasswordReset({
        token: args.token,
        password: args.password,
        confirmPassword: args.confirmPassword,
        ...(args.firstName != null ? { firstName: args.firstName } : {}),
        ...(args.lastName != null ? { lastName: args.lastName } : {}),
        ...(args.fullName != null ? { fullName: args.fullName } : {}),
      });
    },
  },
};
