import type { GraphQLContext } from "@/src/graphql/context";
import { requireSession } from "@/src/graphql/helpers";
import {
  listManagedSubTenantUsers,
  getSubTenantUserActivationLink,
  regenerateSubTenantUserActivationLink,
} from "@/src/modules/tenants/tenant.service";

export const tenantsManagedUsersResolver = {
  Query: {
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
  },
};
