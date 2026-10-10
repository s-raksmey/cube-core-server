import { UserStatus } from "@prisma/client";
import type { GraphQLContext } from "@/src/graphql/context";
import { requireSession } from "@/src/graphql/helpers";
import { updateMainTenantUser } from "@/src/modules/users/main-users.service";

export const usersUpdateMainResolver = {
  Mutation: {
    updateMainTenantUser: async (
      _: unknown,
      args: {
        id: string;
        input: {
          firstName?: string | null;
          lastName?: string | null;
          email?: string | null;
          status?: UserStatus | null;
        };
      },
      ctx: GraphQLContext,
    ) => {
      return updateMainTenantUser(requireSession(ctx), args.id, {
        ...(args.input.firstName != null
          ? { firstName: args.input.firstName }
          : {}),
        ...(args.input.lastName != null
          ? { lastName: args.input.lastName }
          : {}),
        ...(args.input.email != null ? { email: args.input.email } : {}),
        ...(args.input.status != null ? { status: args.input.status } : {}),
      });
    },
  },
};
