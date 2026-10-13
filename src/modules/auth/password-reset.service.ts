import { TenantType, UserStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/src/lib/db";
import {
  hashPassword,
  passwordPolicySchema,
} from "@/src/lib/auth/password";
import type { SessionPayload } from "@/src/lib/auth/session";
import { forbidden, unauthenticated, validationError } from "@/src/lib/errors";
import { writeAuthAudit } from "@/src/modules/auth/audit-auth";
import { revokeAllUserSessions } from "@/src/modules/auth/session.service";
import {
  findManagementHostname,
  managementAppBaseUrl,
} from "@/src/modules/tenants/tenant-domain.service";
import { findAccountByUuid, mapAuthUser } from "@/src/modules/users/account";
import { requireTenantUserPermission } from "@/src/modules/roles/role-permission.service";
import {
  createPasswordResetToken,
  decryptPasswordResetToken,
  findExistingPasswordResetToken,
  findValidPasswordResetToken,
} from "@/src/modules/auth/password-reset-token.service";

export function assertNotSelfPasswordReset(
  actorUserId: string,
  targetUserId: string,
) {
  if (actorUserId === targetUserId) {
    throw validationError("You cannot reset your own account");
  }
}

export async function generateMainTenantUserPasswordResetLink(
  session: SessionPayload,
  targetUserUuid: string,
  correlationId?: string,
) {
  if (session.role !== "SUPERADMIN") {
    throw forbidden("Only SuperAdmin can generate password reset links");
  }

  assertNotSelfPasswordReset(session.userId, targetUserUuid);

  const target = await findAccountByUuid(targetUserUuid);
  if (
    !target ||
    target.tenant.type !== TenantType.MAIN ||
    target.roleCode !== "SUPERADMIN"
  ) {
    throw validationError("User not found");
  }
  if (
    target.status !== UserStatus.ACTIVE &&
    target.status !== UserStatus.LOCKED
  ) {
    throw validationError("Cannot reset password for an inactive user");
  }

  const existing = await findExistingPasswordResetToken(target.uuid);
  const baseUrl = (process.env.ADMIN_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  if (existing?.encryptedToken) {
    return { resetUrl: `${baseUrl}/password-reset?token=${encodeURIComponent(decryptPasswordResetToken(existing.encryptedToken))}`, expiresAt: existing.expiresAt.toISOString(), user: mapAuthUser(target) };
  }

  const { rawToken, expiresAt } = await createPasswordResetToken({
    userUuid: target.uuid,
    createdByUuid: session.userId,
  });

  const resetUrl = `${baseUrl}/password-reset?token=${encodeURIComponent(rawToken)}`;

  await writeAuthAudit({
    action: "auth.password_reset.link_generated",
    actorUserUuid: session.userId,
    tenantUuid: session.tenantId,
    targetType: "user",
    targetUuid: target.uuid,
    correlationId,
    metadata: { expiresAt: expiresAt.toISOString() },
  });

  return {
    resetUrl,
    expiresAt: expiresAt.toISOString(),
    user: mapAuthUser(target),
  };
}

/** Sub-tenant password reset for a permitted tenant user or Main SuperAdmin. */
export async function generateSubTenantUserPasswordResetLink(
  session: SessionPayload,
  targetUserUuid: string,
  correlationId?: string,
) {
  if (session.role === "SUPERADMIN") {
    await requireTenantUserPermission(session, "USERS_RESET_PASSWORD");
  } else {
    if (session.audience !== "TENANT_APP") {
      throw forbidden("Only an authorized tenant user can generate password reset links");
    }
    await requireTenantUserPermission(session, "USERS_RESET_PASSWORD");
  }

  assertNotSelfPasswordReset(session.userId, targetUserUuid);

  const target = await findAccountByUuid(targetUserUuid);
  if (!target || target.tenant.type !== TenantType.SUB) {
    throw validationError("User not found");
  }
  if (session.role !== "SUPERADMIN" && target.tenantUuid !== session.tenantId) {
    throw forbidden("You can only manage users in your own tenant");
  }

  const existing = await findExistingPasswordResetToken(target.uuid);
  const managementHostname = await findManagementHostname(target.tenantUuid);
  const baseUrl = managementAppBaseUrl(managementHostname, process.env.TENANT_APP_URL ?? "http://localhost:3001");
  if (existing?.encryptedToken) {
    return { resetUrl: `${baseUrl}/password-reset?token=${encodeURIComponent(decryptPasswordResetToken(existing.encryptedToken))}`, expiresAt: existing.expiresAt.toISOString(), user: mapAuthUser(target) };
  }

  const { rawToken, expiresAt } = await createPasswordResetToken({
    userUuid: target.uuid,
    createdByUuid: session.userId,
  });

  const resetUrl = `${baseUrl}/password-reset?token=${encodeURIComponent(rawToken)}`;

  await writeAuthAudit({
    action: "auth.password_reset.link_generated",
    actorUserUuid: session.userId,
    tenantUuid: session.tenantId,
    targetType: "user",
    targetUuid: target.uuid,
    correlationId,
    metadata: { expiresAt: expiresAt.toISOString(), scope: "SUB" },
  });

  return {
    resetUrl,
    expiresAt: expiresAt.toISOString(),
    user: mapAuthUser(target),
  };
}

export async function validatePasswordResetToken(token: string) {
  const row = await findValidPasswordResetToken(token);
  if (!row) {
    throw unauthenticated("Invalid or expired reset link");
  }
  const account = await findAccountByUuid(row.userUuid);
  if (
    !account ||
    (account.status !== UserStatus.ACTIVE &&
      account.status !== UserStatus.LOCKED) ||
    !account.username
  ) {
    throw unauthenticated("Invalid or expired reset link");
  }
  return {
    valid: true as const,
    expiresAt: row.expiresAt.toISOString(),
    username: account.username,
  };
}

export async function completePasswordReset(input: {
  token: string;
  password: string;
  confirmPassword: string;
  correlationId?: string;
}) {
  if (input.password !== input.confirmPassword) {
    throw validationError("Passwords do not match");
  }
  const parsedPassword = passwordPolicySchema.safeParse(input.password);
  if (!parsedPassword.success) {
    throw validationError(parsedPassword.error.issues[0]?.message ?? "Invalid password");
  }

  const row = await findValidPasswordResetToken(input.token);
  if (!row) {
    throw unauthenticated("Invalid or expired reset link");
  }

  const account = await findAccountByUuid(row.userUuid);
  if (
    !account ||
    (account.status !== UserStatus.ACTIVE &&
      account.status !== UserStatus.LOCKED)
  ) {
    throw unauthenticated("Invalid or expired reset link");
  }

  const passwordHash = await hashPassword(input.password);

  await prisma.$transaction(async (tx) => {
    const mark = await tx.userPasswordResetToken.updateMany({
      where: { uuid: row.uuid, usedAt: null, revokedAt: null },
      data: { usedAt: new Date() },
    });
    if (mark.count !== 1) {
      throw unauthenticated("Reset link already used");
    }

    const updated = await tx.user.updateMany({
      where: {
        uuid: row.userUuid,
        status: { in: [UserStatus.ACTIVE, UserStatus.LOCKED] },
        ...(account.status === UserStatus.LOCKED && account.lockedUntil
          ? { lockedUntil: account.lockedUntil }
          : {}),
      },
      data: {
        passwordHash,
        failedPasswordAttempts: 0,
        failedTotpAttempts: 0,
        ...(account.status === UserStatus.LOCKED && account.lockedUntil
          ? {
              status: UserStatus.ACTIVE,
              lockedUntil: null,
            }
          : {}),
      },
    });
    if (updated.count !== 1) {
      throw unauthenticated("Invalid or expired reset link");
    }

    await tx.userTwoFactorAuth.updateMany({
      where: { userUuid: row.userUuid },
      data: {
        encryptedSecret: null,
        pendingEncryptedSecret: null,
        pendingExpiresAt: null,
        enabledAt: null,
      },
    });
    await tx.userRecoveryCode.deleteMany({ where: { userUuid: row.userUuid } });
    await tx.authTotpReplayGuard.deleteMany({ where: { userUuid: row.userUuid } });
    await tx.authLoginChallenge.updateMany({
      where: { userUuid: row.userUuid, consumedAt: null },
      data: { consumedAt: new Date() },
    });

    await tx.userPasswordResetToken.updateMany({
      where: {
        userUuid: row.userUuid,
        usedAt: null,
        revokedAt: null,
        uuid: { not: row.uuid },
      },
      data: { revokedAt: new Date() },
    });
  });

  await revokeAllUserSessions(row.userUuid);

  await writeAuthAudit({
    action: "auth.password_reset.completed",
    actorUserUuid: row.userUuid,
    tenantUuid: account.tenantUuid,
    correlationId: input.correlationId,
    metadata: { userUuid: row.userUuid, twoFactorReset: true },
  });

  return { success: true as const };
}
