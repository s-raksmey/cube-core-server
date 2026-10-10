import { mergeResolvers } from "@/src/graphql/helpers";
import { dashboardPlatformResolver } from "@/src/graphql/resolvers/dashboard/dashboard-platform-resolver";
import { dashboardTenantResolver } from "@/src/graphql/resolvers/dashboard/dashboard-tenant-resolver";

export const dashboardResolvers = mergeResolvers(
  dashboardPlatformResolver,
  dashboardTenantResolver,
);
