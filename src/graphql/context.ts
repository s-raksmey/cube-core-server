import { timingSafeEqual } from "node:crypto";
import type { AuthAudience } from "@prisma/client";
import type { YogaInitialContext } from "graphql-yoga";
import { parseCookieHeader } from "@/src/lib/auth/session";
import { ACCESS_COOKIE_BY_AUDIENCE } from "@/src/lib/auth/constants";
import { resolveSessionFromAccessToken } from "@/src/modules/auth/session.service";
import type { SessionPayload } from "@/src/lib/auth/session";

export type GraphQLContext = {
  session: SessionPayload | null;
  trustedAuthAudience: AuthAudience | null;
  request: Request;
};

function trustedAuthAudience(request: Request): AuthAudience | null {
  const provided = request.headers.get("x-cube-auth-action-secret");
  if (!provided) return null;
  for (const [audience, secret] of [
    ["ADMIN_CONSOLE", process.env.ADMIN_AUTH_ACTION_SECRET],
    ["TENANT_APP", process.env.TENANT_AUTH_ACTION_SECRET],
  ] as const) {
    if (!secret) continue;
    const expectedBytes = Buffer.from(secret);
    const providedBytes = Buffer.from(provided);
    if (
      expectedBytes.length === providedBytes.length &&
      timingSafeEqual(expectedBytes, providedBytes)
    ) return audience;
  }
  return null;
}

async function tokenFromRequest(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice("Bearer ".length);
  }

  const cookieHeader = request.headers.get("cookie");
  for (const name of Object.values(ACCESS_COOKIE_BY_AUDIENCE)) {
    const value = parseCookieHeader(cookieHeader, name);
    if (value) return value;
  }

  return null;
}

export async function createContext(
  initial: YogaInitialContext,
): Promise<GraphQLContext> {
  const request = initial.request;
  const token = await tokenFromRequest(request);

  if (!token) {
    return { session: null, trustedAuthAudience: trustedAuthAudience(request), request };
  }

  try {
    const session = await resolveSessionFromAccessToken(token);
    return { session, trustedAuthAudience: trustedAuthAudience(request), request };
  } catch {
    return { session: null, trustedAuthAudience: trustedAuthAudience(request), request };
  }
}
