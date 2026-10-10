import {
  AuthAudience,
  TenantStatus,
  UserStatus,
} from "@prisma/client";
import { prisma } from "@/src/lib/db";
import { REFRESH_TOKEN_TTL_MS } from "@/src/lib/auth/constants";
import { hashToken, randomToken } from "@/src/lib/auth/crypto";
import {
  createAccessToken,
  type SessionPayload,
  verifyAccessToken,
} from "@/src/lib/auth/session";
import { forbidden, unauthenticated } from "@/src/lib/errors";
import {
  findAccountByUuid,
  assertConsoleAuthorization,
  type LoadedAccount,
} from "@/src/modules/users/account";

export type AuthTokens = {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
  audience: AuthAudience;
};

export async function createAuthenticatedSession(input: {
  account: LoadedAccount;
  audience: AuthAudience;
}): Promise<AuthTokens> {
  const refreshToken = randomToken(48);
  const refreshTokenHash = hashToken(refreshToken);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

  const session = await prisma.userSession.create({
    data: {
      userUuid: input.account.uuid,
      tenantUuid: input.account.tenantUuid,
      audience: input.audience,
      refreshTokenHash,
      expiresAt,
    },
  });

  await prisma.user.update({
    where: { uuid: input.account.uuid },
    data: { lastLoginAt: new Date() },
  });

  const payload: SessionPayload = {
    userId: input.account.uuid,
    role: input.account.roleCode,
    tenantId: input.account.tenantUuid,
    audience: input.audience,
    sessionId: session.uuid,
  };

  return {
    accessToken: await createAccessToken(payload),
    refreshToken,
    sessionId: session.uuid,
    audience: input.audience,
  };
}

export async function refreshAuthenticatedSession(input: {
  refreshToken: string;
  audience: AuthAudience;
}) {
  const refreshTokenHash = hashToken(input.refreshToken);
  const session = await prisma.userSession.findUnique({
    where: { refreshTokenHash },
  });

  if (!session || session.revokedAt || session.expiresAt < new Date()) {
    throw unauthenticated("Session expired");
  }
  if (session.audience !== input.audience) {
    throw forbidden("Invalid session for this console");
  }

  const account = await findAccountByUuid(session.userUuid, session.tenantUuid);
  if (!account || account.status !== UserStatus.ACTIVE) {
    throw unauthenticated("Account is not active");
  }
  if (account.tenant.status === TenantStatus.SUSPENDED) {
    throw forbidden("Tenant is suspended");
  }
  if (
    account.sessionsRevokedAt &&
    session.createdAt <= account.sessionsRevokedAt
  ) {
    throw unauthenticated("Session revoked");
  }

  await prisma.userSession.update({
    where: { uuid: session.uuid },
    data: { lastUsedAt: new Date() },
  });

  const accessToken = await createAccessToken({
    userId: account.uuid,
    role: account.roleCode,
    tenantId: account.tenantUuid,
    audience: session.audience,
    sessionId: session.uuid,
  });

  return { accessToken, account, audience: session.audience };
}

export async function revokeSessionById(sessionId: string) {
  await prisma.userSession.updateMany({
    where: { uuid: sessionId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revokeAllUserSessions(userUuid: string) {
  const now = new Date();
  await prisma.$transaction([
    prisma.userSession.updateMany({
      where: { userUuid, revokedAt: null },
      data: { revokedAt: now },
    }),
    prisma.user.update({
      where: { uuid: userUuid },
      data: { sessionsRevokedAt: now },
    }),
  ]);
}

export async function resolveSessionFromAccessToken(token: string) {
  const payload = await verifyAccessToken(token);
  const session = await prisma.userSession.findUnique({
    where: { uuid: payload.sessionId },
  });

  if (
    !session ||
    session.revokedAt ||
    session.expiresAt < new Date() ||
    session.userUuid !== payload.userId ||
    session.tenantUuid !== payload.tenantId ||
    session.audience !== payload.audience
  ) {
    throw unauthenticated();
  }

  const account = await findAccountByUuid(payload.userId, payload.tenantId);
  if (
    !account ||
    account.status !== UserStatus.ACTIVE ||
    account.roleCode !== payload.role
  ) {
    throw unauthenticated();
  }

  if (account.tenant.status === TenantStatus.SUSPENDED) {
    throw forbidden("Tenant is suspended");
  }

  assertConsoleAuthorization(account, payload.audience);

  if (
    account.sessionsRevokedAt &&
    session.createdAt <= account.sessionsRevokedAt
  ) {
    throw unauthenticated();
  }

  return payload;
}
