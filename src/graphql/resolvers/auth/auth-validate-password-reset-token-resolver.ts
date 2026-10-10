import { validatePasswordResetToken } from "@/src/modules/auth/password-reset.service";

export const authValidatePasswordResetTokenResolver = {
  Query: {
    validatePasswordResetToken: async (
      _: unknown,
      args: { token: string },
    ) => {
      return validatePasswordResetToken(args.token);
    },
  },
};
