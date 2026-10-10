import { mergeResolvers } from "@/src/graphql/helpers";
import { tenantsListResolver } from "@/src/graphql/resolvers/tenants/tenants-list-resolver";
import { tenantsUsersResolver } from "@/src/graphql/resolvers/tenants/tenants-users-resolver";
import { tenantsCreateResolver } from "@/src/graphql/resolvers/tenants/tenants-create-resolver";
import { tenantsSetStatusResolver } from "@/src/graphql/resolvers/tenants/tenants-set-status-resolver";
import { tenantsCreateAdminUserResolver } from "@/src/graphql/resolvers/tenants/tenants-create-admin-user-resolver";

export const tenantsResolvers = mergeResolvers(
  tenantsListResolver,
  tenantsUsersResolver,
  tenantsCreateResolver,
  tenantsSetStatusResolver,
  tenantsCreateAdminUserResolver,
);
