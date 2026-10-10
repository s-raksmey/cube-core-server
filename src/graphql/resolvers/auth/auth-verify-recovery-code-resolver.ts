import { verifyRecoveryCode } from "@/src/modules/auth/totp.service";

export const authVerifyRecoveryCodeResolver = {
  Mutation: {
    verifyRecoveryCode: async (
      _: unknown,
      args: { challengeToken: string; code: string },
    ) => {
      const result = await verifyRecoveryCode(args);
      return {
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        audience: result.audience,
        user: result.user,
      };
    },
  },
};
