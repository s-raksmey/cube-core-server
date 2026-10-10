import { AuthAudience } from "@prisma/client";
import { mapAuthUser } from "@/src/modules/users/account";
import { refreshAuthenticatedSession } from "@/src/modules/auth/session.service";

export const authRefreshSessionResolver = {
  Mutation: {
    refreshSession: async (
      _: unknown,
      args: {
        refreshToken: string;
        audience: "ADMIN_CONSOLE" | "TENANT_APP";
      },
    ) => {
      const result = await refreshAuthenticatedSession({
        refreshToken: args.refreshToken,
        audience: args.audience as AuthAudience,
      });
      return {
        accessToken: result.accessToken,
        audience: result.audience,
        user: mapAuthUser(result.account),
      };
    },
  },
};
