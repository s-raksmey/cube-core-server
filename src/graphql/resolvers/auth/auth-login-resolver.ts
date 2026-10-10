import { loginWithPassword } from "@/src/modules/auth/auth.service";
import { unauthenticated } from "@/src/lib/errors";

export const authLoginResolver = {
  Mutation: {
    login: async (
      _: unknown,
      args: {
        email: string;
        password: string;
        audience?: "ADMIN_CONSOLE" | "TENANT_APP";
      },
    ) => {
      const result = await loginWithPassword(
        args.email,
        args.password,
        args.audience ?? "ADMIN_CONSOLE",
      );
      if (result.status === "CHALLENGE") {
        return {
          challengeToken: result.challengeToken,
          nextStep: result.nextStep,
          qrCodeDataUrl: result.qrCodeDataUrl ?? null,
          manualEntryKey: result.manualEntryKey ?? null,
        };
      }
      throw unauthenticated("Unexpected login state");
    },
  },
};
