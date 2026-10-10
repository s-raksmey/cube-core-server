import type { YogaInitialContext } from "graphql-yoga";
import { parseCookieHeader } from "@/src/lib/auth/session";
import { ACCESS_COOKIE_BY_AUDIENCE } from "@/src/lib/auth/constants";
import { resolveSessionFromAccessToken } from "@/src/modules/auth/session.service";
import type { SessionPayload } from "@/src/lib/auth/session";

export type GraphQLContext = {
  session: SessionPayload | null;
  request: Request;
};

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
    return { session: null, request };
  }

  try {
    const session = await resolveSessionFromAccessToken(token);
    return { session, request };
  } catch {
    return { session: null, request };
  }
}
