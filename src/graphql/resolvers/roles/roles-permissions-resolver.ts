import type { GraphQLContext } from "@/src/graphql/context";
import { requireSession } from "@/src/graphql/helpers";
import { getTenantUserPermissions, listTenantRolePermissionSummary, listTenantRolePermissions, updateTenantRolePermissions } from "@/src/modules/roles/role-permission.service";

export const rolesPermissionsResolver = {
  Query: {
    tenantRolePermissions: (_: unknown, _args: unknown, ctx: GraphQLContext) =>
      listTenantRolePermissions(requireSession(ctx)),
    tenantUserPermissions: (_: unknown, _args: unknown, ctx: GraphQLContext) =>
      getTenantUserPermissions(requireSession(ctx)),
    tenantRolePermissionSummary: (_: unknown, _args: unknown, ctx: GraphQLContext) =>
      listTenantRolePermissionSummary(requireSession(ctx)),
  },
  Mutation: {
    updateTenantRolePermissions: (_: unknown, args: { input: unknown }, ctx: GraphQLContext) =>
      updateTenantRolePermissions(requireSession(ctx), args.input),
  },
};
