import { AuthAudience } from "@prisma/client";
import { mapAuthUser } from "@/src/modules/users/account";
import { refreshAuthenticatedSession } from "@/src/modules/auth/session.service";
import type { GraphQLContext } from "@/src/graphql/context";
import { requireTrustedAuthAction } from "@/src/graphql/helpers";

export const authRefreshSessionResolver = {
  Mutation: {
    refreshSession: async (
      _: unknown,
      args: {
        refreshToken: string;
        audience: "ADMIN_CONSOLE" | "TENANT_APP";
      },
      ctx: GraphQLContext,
    ) => {
      requireTrustedAuthAction(ctx, args.audience);
      const result = await refreshAuthenticatedSession({
        refreshToken: args.refreshToken,
        audience: args.audience as AuthAudience,
      });
      return {
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        audience: result.audience,
        user: mapAuthUser(result.account),
      };
    },
  },
};
