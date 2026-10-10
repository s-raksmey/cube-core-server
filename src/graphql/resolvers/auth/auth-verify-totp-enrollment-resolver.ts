import { verifyTotpEnrollment } from "@/src/modules/auth/totp.service";

export const authVerifyTotpEnrollmentResolver = {
  Mutation: {
    verifyTotpEnrollment: async (
      _: unknown,
      args: { challengeToken: string; code: string },
    ) => {
      const result = await verifyTotpEnrollment(args);
      return {
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        audience: result.audience,
        user: result.user,
      };
    },
  },
};
