import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createSchema } from "graphql-yoga";
import type { GraphQLContext } from "@/src/graphql/context";
import { mergeResolvers } from "@/src/graphql/helpers";
import { typeResolvers } from "@/src/graphql/resolvers/types";
import { authResolvers } from "@/src/graphql/resolvers/auth";
import { dashboardResolvers } from "@/src/graphql/resolvers/dashboard";
import { tenantsResolvers } from "@/src/graphql/resolvers/tenants";
import { usersResolvers } from "@/src/graphql/resolvers/users";

const typeDefs = readFileSync(
  join(process.cwd(), "src/graphql/schema.graphql"),
  "utf8",
);

export const schema = createSchema<GraphQLContext>({
  typeDefs,
  resolvers: mergeResolvers(
    typeResolvers,
    authResolvers,
    dashboardResolvers,
    tenantsResolvers,
    usersResolvers,
  ),
});
