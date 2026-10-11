import type { GraphQLContext } from "@/src/graphql/context";
import { requireSession } from "@/src/graphql/helpers";
import { deleteTenantUser, generateTenantUserActivationLink, generateTenantUserPasswordResetLink, getTenantUserActivationLink, updateTenantUser } from "@/src/modules/tenants/tenant.service";

export const tenantsDeleteUserResolver = {
  Query: {
    tenantUserActivationLink: async (_: unknown, args: { userId: string }, ctx: GraphQLContext) => getTenantUserActivationLink(requireSession(ctx), args.userId),
  },
  Mutation: {
    updateTenantUser: async (_: unknown, args: { id: string; input: unknown }, ctx: GraphQLContext) => updateTenantUser(requireSession(ctx), args.id, args.input),
    generateTenantUserActivationLink: async (_: unknown, args: { userId: string }, ctx: GraphQLContext) => generateTenantUserActivationLink(requireSession(ctx), args.userId),
    generateTenantUserPasswordResetLink: async (_: unknown, args: { userId: string }, ctx: GraphQLContext) => generateTenantUserPasswordResetLink(requireSession(ctx), args.userId),
    deleteTenantUser: async (
      _: unknown,
      args: { id: string },
      ctx: GraphQLContext,
    ) => deleteTenantUser(requireSession(ctx), args.id),
  },
};
