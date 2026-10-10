import { TenantStatus, UserStatus } from "@prisma/client";
import type { AuthAudience } from "@prisma/client";
import { verifyPassword } from "@/src/lib/auth/password";
import { unauthenticated } from "@/src/lib/errors";
import { writeAuthAudit } from "@/src/modules/auth/audit-auth";
import {
  beginTotpEnrollment,
  createLoginChallenge,
} from "@/src/modules/auth/totp.service";
import {
  assertConsoleAuthorization,
  findAccountByEmailOrUsername,
  findAccountByUuid,
  mapAuthUser,
} from "@/src/modules/users/account";

export type LoginAudience = AuthAudience;

export type LoginStepResult =
  | {
      status: "CHALLENGE";
      nextStep: "TOTP_ENROLL" | "TOTP_VERIFY";
      challengeToken: string;
      qrCodeDataUrl?: string;
      manualEntryKey?: string;
    }
  | {
      status: "AUTHENTICATED";
      accessToken: string;
      refreshToken: string;
      audience: AuthAudience;
      user: ReturnType<typeof mapAuthUser>;
    };

export async function loginWithPassword(
  identifier: string,
  password: string,
  audience: LoginAudience = "ADMIN_CONSOLE",
  correlationId?: string,
): Promise<LoginStepResult> {
  const normalizedId = identifier.trim().toLowerCase();
  const normalizedPassword = password.trim();
  if (!normalizedId || !normalizedPassword) {
    throw unauthenticated("Invalid email or password");
  }

  const account = await findAccountByEmailOrUsername(normalizedId);

  if (!account || account.status !== UserStatus.ACTIVE || !account.passwordHash) {
    await writeAuthAudit({
      action: "auth.login.failed",
      correlationId,
      metadata: { reason: "invalid_credentials", audience },
    });
    throw unauthenticated("Invalid email or password");
  }

  if (account.tenant.status === TenantStatus.SUSPENDED) {
    throw unauthenticated("Invalid email or password");
  }

  const valid = await verifyPassword(normalizedPassword, account.passwordHash);
  if (!valid) {
    await writeAuthAudit({
      action: "auth.login.failed",
      actorUserUuid: account.uuid,
      tenantUuid: account.tenantUuid,
      correlationId,
      metadata: { reason: "invalid_credentials", audience },
    });
    throw unauthenticated("Invalid email or password");
  }

  try {
    assertConsoleAuthorization(account, audience);
  } catch (error) {
    await writeAuthAudit({
      action: "auth.login.rejected_console",
      actorUserUuid: account.uuid,
      tenantUuid: account.tenantUuid,
      correlationId,
      metadata: { audience, role: account.roleCode },
    });
    throw error;
  }

  if (!account.totpEnabledAt || !account.totpSecretEnc) {
    const enrollment = await beginTotpEnrollment({
      userUuid: account.uuid,
      tenantUuid: account.tenantUuid,
      email: account.email,
      audience,
    });
    await writeAuthAudit({
      action: "auth.2fa.enrollment.started",
      actorUserUuid: account.uuid,
      tenantUuid: account.tenantUuid,
      correlationId,
    });
    return {
      status: "CHALLENGE",
      nextStep: "TOTP_ENROLL",
      challengeToken: enrollment.challengeToken,
      qrCodeDataUrl: enrollment.qrCodeDataUrl,
      manualEntryKey: enrollment.manualEntryKey,
    };
  }

  const { challengeToken } = await createLoginChallenge({
    userUuid: account.uuid,
    tenantUuid: account.tenantUuid,
    audience,
    type: "TOTP_VERIFY",
  });

  return {
    status: "CHALLENGE",
    nextStep: "TOTP_VERIFY",
    challengeToken,
  };
}

export async function getMe(userId: string, tenantId?: string) {
  const account = await findAccountByUuid(userId, tenantId);
  if (!account) return null;
  return mapAuthUser(account);
}
