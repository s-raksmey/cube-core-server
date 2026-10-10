import { verifyLoginTotp } from "@/src/modules/auth/totp.service";

export const authVerifyLoginTotpResolver = {
  Mutation: {
    verifyLoginTotp: async (
      _: unknown,
      args: { challengeToken: string; code: string },
    ) => {
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
