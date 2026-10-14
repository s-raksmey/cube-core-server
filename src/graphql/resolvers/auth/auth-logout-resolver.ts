import type { GraphQLContext } from "@/src/graphql/context";
import { revokeSessionById } from "@/src/modules/auth/session.service";
import { writeAuthAudit } from "@/src/modules/auth/audit-auth";

export const authLogoutResolver = {
  Mutation: {
    logout: async (_: unknown, __: unknown, ctx: GraphQLContext) => {
      if (ctx.session) {
        await revokeSessionById(ctx.session.sessionId);
        await writeAuthAudit({
          action: "auth.logout.success",
          actorUserUuid: ctx.session.userId,
          tenantUuid: ctx.session.tenantId,
          targetType: "session",
          targetUuid: ctx.session.sessionId,
        });
      }
      return true;
    },
  },
};
