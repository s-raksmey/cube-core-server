import { SignJWT, jwtVerify } from "jose";
import type { AuthAudience } from "@prisma/client";
import {
  ACCESS_TOKEN_TTL,
  CHALLENGE_TTL_MS,
} from "@/src/lib/auth/constants";

export type SessionPayload = {
  userId: string;
  role: string;
  tenantId: string;
  audience: AuthAudience;
  sessionId: string;
};

export type AccessTokenPayload = SessionPayload;

export type ChallengeTokenPayload = {
  challengeId: string;
  userId: string;
  tenantId: string;
  audience: AuthAudience;
  type: "TOTP_ENROLL" | "TOTP_VERIFY" | "RECOVERY";
};

function getSecret() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("AUTH_SECRET is not configured");
  }
  return new TextEncoder().encode(secret);
}

export async function createAccessToken(payload: SessionPayload) {
  return new SignJWT({
    userId: payload.userId,
    role: payload.role,
    tenantId: payload.tenantId,
    audience: payload.audience,
    sessionId: payload.sessionId,
    typ: "access",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(ACCESS_TOKEN_TTL)
    .sign(getSecret());
}

export async function verifyAccessToken(token: string): Promise<AccessTokenPayload> {
  const { payload } = await jwtVerify(token, getSecret());
  if (payload.typ !== "access") {
    throw new Error("Invalid token type");
  }
  return {
    userId: String(payload.userId),
    role: String(payload.role),
    tenantId: String(payload.tenantId),
    audience: payload.audience as AuthAudience,
    sessionId: String(payload.sessionId),
  };
}

export async function createChallengeToken(payload: ChallengeTokenPayload) {
  const expiresInSeconds = Math.floor(CHALLENGE_TTL_MS / 1000);
  return new SignJWT({
    ...payload,
    typ: "challenge",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${expiresInSeconds}s`)
    .sign(getSecret());
}

export async function verifyChallengeToken(
  token: string,
): Promise<ChallengeTokenPayload> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (payload.typ !== "challenge") {
      throw new Error("Invalid token type");
    }
    return {
      challengeId: String(payload.challengeId),
      userId: String(payload.userId),
      tenantId: String(payload.tenantId),
      audience: payload.audience as AuthAudience,
      type: payload.type as ChallengeTokenPayload["type"],
    };
  } catch {
    throw new Error("Invalid or expired challenge");
  }
}

export function parseCookieHeader(cookieHeader: string | null, name: string) {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(";").map((part) => part.trim());
  for (const part of parts) {
    const [key, ...rest] = part.split("=");
    if (key === name) {
      return decodeURIComponent(rest.join("="));
    }
  }
  return null;
}
