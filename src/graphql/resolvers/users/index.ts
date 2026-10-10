import { mergeResolvers } from "@/src/graphql/helpers";
import { usersListMainResolver } from "@/src/graphql/resolvers/users/users-list-main-resolver";
import { usersGetMainResolver } from "@/src/graphql/resolvers/users/users-get-main-resolver";
import { usersCreateMainResolver } from "@/src/graphql/resolvers/users/users-create-main-resolver";
import { usersUpdateMainResolver } from "@/src/graphql/resolvers/users/users-update-main-resolver";
import { usersDeleteMainResolver } from "@/src/graphql/resolvers/users/users-delete-main-resolver";
import { usersGeneratePasswordResetLinkResolver } from "@/src/graphql/resolvers/users/users-generate-password-reset-link-resolver";
import { usersGenerateActivationLinkResolver } from "@/src/graphql/resolvers/users/users-generate-activation-link-resolver";

export const usersResolvers = mergeResolvers(
  usersListMainResolver,
  usersGetMainResolver,
  usersCreateMainResolver,
  usersUpdateMainResolver,
  usersDeleteMainResolver,
  usersGeneratePasswordResetLinkResolver,
  usersGenerateActivationLinkResolver,
);
