import type { GraphQLContext } from "@/src/graphql/context";
import { requireSession } from "@/src/graphql/helpers";
import {
  updateManagedSubTenantUser,
  generateManagedSubTenantUserPasswordResetLink,
  getManagedSubTenantUserPasswordResetLink,
  deleteManagedSubTenantUser,
} from "@/src/modules/tenants/tenant-user-management.service";
import {
  getSubTenantUserActivationLink,
  regenerateSubTenantUserActivationLink,
} from "@/src/modules/tenants/tenant-user-activation.service";
import { listManagedSubTenantUsers } from "@/src/modules/tenants/tenant-user-query.service";

export const tenantsManagedUsersResolver = {
  Query: {
    subTenantUserPasswordResetLink: (_: unknown, args: { tenantId: string; userId: string }, ctx: GraphQLContext) => getManagedSubTenantUserPasswordResetLink(requireSession(ctx), args.tenantId, args.userId),
    subTenantUserActivationLink: async (
      _: unknown,
      args: { tenantId: string; userId: string },
      ctx: GraphQLContext,
    ) => getSubTenantUserActivationLink(
      requireSession(ctx),
      args.tenantId,
      args.userId,
    ),
    subTenantUsers: async (
      _: unknown,
      args: { tenantId: string; search?: string | null; page?: number; pageSize?: number },
      ctx: GraphQLContext,
    ) => listManagedSubTenantUsers(requireSession(ctx), args),
  },
  Mutation: {
    regenerateSubTenantUserActivationLink: async (
      _: unknown,
      args: { tenantId: string; userId: string },
      ctx: GraphQLContext,
    ) => regenerateSubTenantUserActivationLink(
      requireSession(ctx),
      args.tenantId,
      args.userId,
    ),
    updateManagedSubTenantUser: (_: unknown, args: { tenantId: string; userId: string; input: unknown }, ctx: GraphQLContext) =>
      updateManagedSubTenantUser(requireSession(ctx), args.tenantId, args.userId, args.input),
    generateManagedSubTenantUserPasswordResetLink: (_: unknown, args: { tenantId: string; userId: string }, ctx: GraphQLContext) =>
      generateManagedSubTenantUserPasswordResetLink(requireSession(ctx), args.tenantId, args.userId),
    deleteManagedSubTenantUser: (_: unknown, args: { tenantId: string; userId: string }, ctx: GraphQLContext) =>
      deleteManagedSubTenantUser(requireSession(ctx), args.tenantId, args.userId),
  },
};
