import { timingSafeEqual } from "node:crypto";
import type { AuthAudience } from "@prisma/client";
import type { YogaInitialContext } from "graphql-yoga";
import { parseCookieHeader } from "@/src/lib/auth/session";
import { ACCESS_COOKIE_BY_AUDIENCE } from "@/src/lib/auth/constants";
import { resolveSessionFromAccessToken } from "@/src/modules/auth/session.service";
import type { SessionPayload } from "@/src/lib/auth/session";
import { TenantDomainPurpose } from "@prisma/client";
import { findActiveTenantByHostname } from "@/src/modules/tenants/tenant-domain.service";

export type GraphQLContext = {
  session: SessionPayload | null;
  tenantHostMismatch: boolean;
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
    return {
      session: null,
      tenantHostMismatch: false,
      trustedAuthAudience: trustedAuthAudience(request),
      request,
    };
  }

  try {
    const session = await resolveSessionFromAccessToken(token);
    const managementHostname = request.headers.get(
      "x-cube-tenant-management-host",
    );
    if (managementHostname) {
      // This binding only rejects a session whose tenant differs from the
      // hostname. The signed session and membership remain the authority.
      const tenant = await findActiveTenantByHostname(
        managementHostname,
        TenantDomainPurpose.MANAGEMENT,
      );
      if (!tenant || tenant.uuid !== session.tenantId) {
        return {
          session: null,
          tenantHostMismatch: true,
          trustedAuthAudience: trustedAuthAudience(request),
          request,
        };
      }
    }
    return {
      session,
      tenantHostMismatch: false,
      trustedAuthAudience: trustedAuthAudience(request),
      request,
    };
  } catch {
    return {
      session: null,
      tenantHostMismatch: false,
      trustedAuthAudience: trustedAuthAudience(request),
      request,
    };
  }
}
