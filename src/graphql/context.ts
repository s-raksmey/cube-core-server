import type { YogaInitialContext } from "graphql-yoga";
import {
  parseCookieHeader,
  SESSION_COOKIE,
  verifySessionToken,
  type SessionPayload,
} from "@/src/lib/auth/session";

export type GraphQLContext = {
  session: SessionPayload | null;
  request: Request;
};

export async function createContext(
  initial: YogaInitialContext,
): Promise<GraphQLContext> {
  const request = initial.request;
  const authHeader = request.headers.get("authorization");
  const bearer = authHeader?.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length)
    : null;
  const cookieToken = parseCookieHeader(
    request.headers.get("cookie"),
    SESSION_COOKIE,
  );
  const token = bearer || cookieToken;

  if (!token) {
    return { session: null, request };
  }

  try {
    const session = await verifySessionToken(token);
    return { session, request };
  } catch {
    return { session: null, request };
  }
}
