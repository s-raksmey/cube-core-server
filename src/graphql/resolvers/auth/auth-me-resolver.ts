import type { GraphQLContext } from "@/src/graphql/context";
import { getMe } from "@/src/modules/auth/auth.service";

export const authMeResolver = {
  Query: {
    me: async (_: unknown, __: unknown, ctx: GraphQLContext) => {
      if (!ctx.session) return null;
      return getMe(ctx.session.userId, ctx.session.tenantId);
    },
  },
};
