import type { GraphQLContext } from "@/src/graphql/context";
import { requireSession } from "@/src/graphql/helpers";
import {
  getTenantAuditLogs,
  getTenantDashboard,
} from "@/src/modules/dashboard/dashboard.service";

export const dashboardTenantResolver = {
  Query: {
    tenantDashboard: async (_: unknown, __: unknown, ctx: GraphQLContext) => {
      return getTenantDashboard(requireSession(ctx));
    },
    tenantAuditLogs: async (
      _: unknown,
      args: { page?: number | null },
      ctx: GraphQLContext,
    ) => {
      return getTenantAuditLogs(requireSession(ctx), args.page);
    },
  },
};
