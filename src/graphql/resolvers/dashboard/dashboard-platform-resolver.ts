import type { GraphQLContext } from "@/src/graphql/context";
import { requireSession } from "@/src/graphql/helpers";
import {
  getPlatformAuditLogs,
  getPlatformDashboard,
} from "@/src/modules/dashboard/dashboard.service";

export const dashboardPlatformResolver = {
  Query: {
    platformDashboard: async (
      _: unknown,
      __: unknown,
      ctx: GraphQLContext,
    ) => {
      return getPlatformDashboard(requireSession(ctx));
    },
    platformAuditLogs: async (
      _: unknown,
      args: { page?: number | null },
      ctx: GraphQLContext,
    ) => {
      return getPlatformAuditLogs(requireSession(ctx), args.page);
    },
  },
};
