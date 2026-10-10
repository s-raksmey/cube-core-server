import type { GraphQLContext } from "@/src/graphql/context";
import { revokeSessionById } from "@/src/modules/auth/session.service";

export const authLogoutResolver = {
  Mutation: {
    logout: async (_: unknown, __: unknown, ctx: GraphQLContext) => {
      if (ctx.session) {
        await revokeSessionById(ctx.session.sessionId);
      }
      return true;
    },
  },
};
