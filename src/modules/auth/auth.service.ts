import { TenantStatus, UserStatus } from "@prisma/client";
import type { AuthAudience } from "@prisma/client";
import { verifyPassword } from "@/src/lib/auth/password";
import { unauthenticated } from "@/src/lib/errors";
import { writeAuthAudit } from "@/src/modules/auth/audit-auth";
import {
  accountLockedNotice,
  accountStatusLoginNotice,
  clearExpiredAccountLockout,
  failedAttemptNotice,
  INVALID_PASSWORD_LOGIN_NOTICE,
  recordFailedAuthAttempt,
  resetFailedPasswordAttempts,
} from "@/src/modules/auth/lockout.service";
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
  const normalizedPassword = password;
  if (!normalizedId || !normalizedPassword) {
    throw unauthenticated(INVALID_PASSWORD_LOGIN_NOTICE);
  }

  let account = await findAccountByEmailOrUsername(normalizedId);

  if (account?.status === UserStatus.LOCKED) {
    const unlocked = await clearExpiredAccountLockout(account.uuid);
    if (unlocked) account = await findAccountByEmailOrUsername(normalizedId);
    else throw unauthenticated(accountLockedNotice(account.lockedUntil));
  }

  if (account) {
    const statusNotice = accountStatusLoginNotice(account.status);
    if (statusNotice) {
      await writeAuthAudit({
        action: "auth.login.rejected_status",
        actorUserUuid: account.uuid,
        tenantUuid: account.tenantUuid,
        correlationId,
        metadata: { status: account.status, audience },
      });
      throw unauthenticated(statusNotice);
    }
  }

  if (!account || account.status !== UserStatus.ACTIVE || !account.passwordHash) {
    await writeAuthAudit({
      action: "auth.login.failed",
      correlationId,
      metadata: { reason: "invalid_credentials", audience },
    });
    throw unauthenticated(INVALID_PASSWORD_LOGIN_NOTICE);
  }

  if (account.tenant.status === TenantStatus.SUSPENDED) {
    throw unauthenticated(INVALID_PASSWORD_LOGIN_NOTICE);
  }

  const valid = await verifyPassword(normalizedPassword, account.passwordHash);
  if (!valid) {
    const attempt = await recordFailedAuthAttempt(account, "password");
    await writeAuthAudit({
      action: "auth.login.failed",
      actorUserUuid: account.uuid,
      tenantUuid: account.tenantUuid,
      correlationId,
      metadata: { reason: "invalid_credentials", audience },
    });
    if (attempt.locked) {
      throw unauthenticated(accountLockedNotice(new Date(Date.now() + 15 * 60 * 1000)));
    }
    throw unauthenticated(failedAttemptNotice("password", attempt.remaining));
  }

  await resetFailedPasswordAttempts(account.uuid);

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
