import type { GraphQLContext } from "@/src/graphql/context";
import { requireSession } from "@/src/graphql/helpers";
import { getPlatformAnalytics, getTenantAnalytics } from "@/src/modules/analytics/analytics.service";

export const analyticsResolver = {
  Query: {
    platformAnalytics: (_: unknown, args: { range?: unknown }, context: GraphQLContext) =>
      getPlatformAnalytics(requireSession(context), args.range),
    tenantAnalytics: (_: unknown, args: { range?: unknown }, context: GraphQLContext) =>
      getTenantAnalytics(requireSession(context), args.range),
  },
};
