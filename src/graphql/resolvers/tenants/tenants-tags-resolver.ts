import type { GraphQLContext } from "@/src/graphql/context";
import { requireSession } from "@/src/graphql/helpers";
import * as tags from "@/src/modules/tenants/tag.service";
export const tenantsTagsResolver = {
  Query: {
    tags: (_: unknown, args: { search?: string; page?: number; pageSize?: number }, context: GraphQLContext) => tags.listTags(requireSession(context), args.search, args.page, args.pageSize),
    tag: (_: unknown, args: { id: string }, context: GraphQLContext) => tags.getTag(requireSession(context), args.id),
  },
  Mutation: {
    createTag: (_: unknown, args: { input: unknown }, context: GraphQLContext) => tags.createTag(requireSession(context), args.input),
    updateTag: (_: unknown, args: { id: string; input: unknown }, context: GraphQLContext) => tags.updateTag(requireSession(context), args.id, args.input),
    deleteTag: (_: unknown, args: { id: string }, context: GraphQLContext) => tags.deleteTag(requireSession(context), args.id),
  },
};
