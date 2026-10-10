import type { GraphQLContext } from "@/src/graphql/context";
import { unauthenticated } from "@/src/lib/errors";

export function requireSession(ctx: GraphQLContext) {
  if (!ctx.session) {
    throw unauthenticated();
  }
  return ctx.session;
}

export function toIso(value: Date | string) {
  return value instanceof Date ? value.toISOString() : value;
}

type ResolverMap = Record<string, Record<string, unknown>>;

/** Shallow-merge Query/Mutation/type field maps from many resolver modules. */
export function mergeResolvers(...maps: ResolverMap[]): ResolverMap {
  const result: ResolverMap = {};
  for (const map of maps) {
    for (const [typeName, fields] of Object.entries(map)) {
      result[typeName] = { ...(result[typeName] ?? {}), ...fields };
    }
  }
  return result;
}
