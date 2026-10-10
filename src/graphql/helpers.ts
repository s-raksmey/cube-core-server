import type { GraphQLContext } from "@/src/graphql/context";
import type { AuthAudience } from "@prisma/client";
import { forbidden, unauthenticated } from "@/src/lib/errors";
import { verifyChallengeToken } from "@/src/lib/auth/session";

export function requireSession(ctx: GraphQLContext) {
  if (!ctx.session) {
    throw unauthenticated();
  }
  return ctx.session;
}

export function requireTrustedAuthAction(ctx: GraphQLContext, audience: AuthAudience) {
  if (ctx.trustedAuthAudience !== audience) {
    throw forbidden("This authentication operation is available only to the trusted application server");
  }
}

export async function requireTrustedChallengeAction(
  ctx: GraphQLContext,
  challengeToken: string,
) {
  let challenge;
  try {
    challenge = await verifyChallengeToken(challengeToken);
  } catch {
    throw unauthenticated("Sign-in challenge expired. Please sign in again.");
  }
  requireTrustedAuthAction(ctx, challenge.audience);
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
