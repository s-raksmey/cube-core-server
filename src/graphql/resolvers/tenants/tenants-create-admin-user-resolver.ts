import type { GraphQLContext } from "@/src/graphql/context";
import { requireSession } from "@/src/graphql/helpers";
import { createAdminUser } from "@/src/modules/tenants/tenant.service";

export const tenantsCreateAdminUserResolver = {
  Mutation: {
    createAdminUser: async (
      _: unknown,
      args: {
        email: string;
        firstName: string;
        lastName: string;
        tenantId?: string | null;
        role?: "ADMIN" | "EDITOR";
      },
      ctx: GraphQLContext,
    ) => {
      return createAdminUser(requireSession(ctx), {
        email: args.email,
        firstName: args.firstName,
        lastName: args.lastName,
        ...(args.tenantId ? { tenantId: args.tenantId } : {}),
        ...(args.role ? { role: args.role } : {}),
      });
    },
  },
};
