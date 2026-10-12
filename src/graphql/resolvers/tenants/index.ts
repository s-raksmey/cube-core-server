import { mergeResolvers } from "@/src/graphql/helpers";
import { tenantsListResolver } from "@/src/graphql/resolvers/tenants/tenants-list-resolver";
import { tenantsUsersResolver } from "@/src/graphql/resolvers/tenants/tenants-users-resolver";
import { tenantsCreateResolver } from "@/src/graphql/resolvers/tenants/tenants-create-resolver";
import { tenantsSetStatusResolver } from "@/src/graphql/resolvers/tenants/tenants-set-status-resolver";
import { tenantsCreateAdminUserResolver } from "@/src/graphql/resolvers/tenants/tenants-create-admin-user-resolver";
import { tenantsDeleteUserResolver } from "@/src/graphql/resolvers/tenants/tenants-delete-user-resolver";
import { tenantsGetResolver } from "@/src/graphql/resolvers/tenants/tenants-get-resolver";
import { tenantsResolveHostnameResolver } from "@/src/graphql/resolvers/tenants/tenants-resolve-hostname-resolver";
import { tenantsDomainsResolver } from "@/src/graphql/resolvers/tenants/tenants-domains-resolver";
import { tenantsUpdateResolver } from "@/src/graphql/resolvers/tenants/tenants-update-resolver";
import { tenantsManagedUsersResolver } from "@/src/graphql/resolvers/tenants/tenants-managed-users-resolver";
import { tenantsResolveLocalDevelopmentResolver } from "@/src/graphql/resolvers/tenants/tenants-resolve-local-development-resolver";
import { tenantsBrandingResolver } from "@/src/graphql/resolvers/tenants/tenants-branding-resolver";

export const tenantsResolvers = mergeResolvers(
  tenantsListResolver,
  tenantsUsersResolver,
  tenantsCreateResolver,
  tenantsSetStatusResolver,
  tenantsCreateAdminUserResolver,
  tenantsDeleteUserResolver,
  tenantsGetResolver,
  tenantsResolveHostnameResolver,
  tenantsDomainsResolver,
  tenantsUpdateResolver,
  tenantsManagedUsersResolver,
  tenantsResolveLocalDevelopmentResolver,
  tenantsBrandingResolver,
);
