import { TenantDomainPurpose, TenantStatus, UserStatus } from "@prisma/client";
import type { AuthAudience } from "@prisma/client";
import { z } from "zod";
import { verifyPassword } from "@/src/lib/auth/password";
import { unauthenticated } from "@/src/lib/errors";
import {
  findActiveTenantByHostname,
} from "@/src/modules/tenants/tenant-domain.service";
import { findLocalDevelopmentTenant } from "@/src/modules/tenants/local-development-tenant.service";
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

const loginInputSchema = z.object({
  identifier: z.string().trim().min(1).max(254),
  password: z.string().min(1).max(128),
  audience: z.enum(["ADMIN_CONSOLE", "TENANT_APP"]),
  tenantHostname: z.string().trim().min(1).max(253).optional(),
});

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
  tenantHostname?: string,
): Promise<LoginStepResult> {
  const parsed = loginInputSchema.safeParse({ identifier, password, audience, tenantHostname });
  if (!parsed.success) {
    throw unauthenticated(INVALID_PASSWORD_LOGIN_NOTICE);
  }
  const normalizedId = parsed.data.identifier.toLowerCase();
  const normalizedPassword = parsed.data.password;
  let targetTenantUuid: string | undefined;
  if (audience === "TENANT_APP") {
    if (!parsed.data.tenantHostname) {
      throw unauthenticated("Select a tenant before signing in");
    }
    if (parsed.data.tenantHostname === "localhost") {
      if (process.env.NODE_ENV === "production") {
        throw unauthenticated(INVALID_PASSWORD_LOGIN_NOTICE);
      }
      const tenant = await findLocalDevelopmentTenant();
      if (!tenant) throw unauthenticated("This tenant console address is unavailable");
      targetTenantUuid = tenant.uuid;
    } else {
      const tenant = await findActiveTenantByHostname(
        parsed.data.tenantHostname,
        TenantDomainPurpose.MANAGEMENT,
      );
      if (!tenant) throw unauthenticated(INVALID_PASSWORD_LOGIN_NOTICE);
      targetTenantUuid = tenant.uuid;
    }
  } else if (parsed.data.tenantHostname) {
    throw unauthenticated(INVALID_PASSWORD_LOGIN_NOTICE);
  }

  let account = await findAccountByEmailOrUsername(normalizedId, targetTenantUuid);

  if (account?.status === UserStatus.LOCKED) {
    const unlocked = await clearExpiredAccountLockout(account.uuid);
    if (unlocked) account = await findAccountByEmailOrUsername(normalizedId, targetTenantUuid);
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
