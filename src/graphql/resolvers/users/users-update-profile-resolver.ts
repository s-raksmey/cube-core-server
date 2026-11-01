import type { GraphQLContext } from "@/src/graphql/context";
import { requireSession } from "@/src/graphql/helpers";
import { updateMyProfile } from "@/src/modules/users/profile.service";

export const usersUpdateProfileResolver = {
  Mutation: { updateMyProfile: (_: unknown, args: { input: unknown }, context: GraphQLContext) => updateMyProfile(requireSession(context), args.input) },
};
