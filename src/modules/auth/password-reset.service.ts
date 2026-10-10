import { TenantType, UserStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/src/lib/db";
import { PASSWORD_RESET_TTL_MS } from "@/src/lib/auth/constants";
import { hashToken, randomToken } from "@/src/lib/auth/crypto";
import {
  hashPassword,
  passwordPolicySchema,
} from "@/src/lib/auth/password";
import type { SessionPayload } from "@/src/lib/auth/session";
import { forbidden, unauthenticated, validationError } from "@/src/lib/errors";
import { writeAuthAudit } from "@/src/modules/auth/audit-auth";
import { revokeAllUserSessions } from "@/src/modules/auth/session.service";
import {
  displayFullName,
  findAccountByUuid,
  mapAuthUser,
} from "@/src/modules/users/account";

function normalizeName(name: string) {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

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
  if (target.status !== UserStatus.ACTIVE) {
    throw validationError("Cannot reset password for a non-active user");
  }

  const rawToken = randomToken(32);
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS);

  await prisma.$transaction([
    prisma.userPasswordResetToken.updateMany({
      where: { userUuid: target.uuid, usedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
    prisma.userPasswordResetToken.create({
      data: {
        userUuid: target.uuid,
        tokenHash,
        expiresAt,
        createdByUuid: session.userId,
      },
    }),
  ]);

  const baseUrl = (process.env.ADMIN_APP_URL ?? "http://localhost:3000").replace(
    /\/$/,
    "",
  );
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

/** Sub-tenant password reset (SuperAdmin remote). */
export async function generateSubTenantUserPasswordResetLink(
  session: SessionPayload,
  targetUserUuid: string,
  correlationId?: string,
) {
  if (session.role !== "SUPERADMIN") {
    throw forbidden("Only SuperAdmin can generate password reset links");
  }

  assertNotSelfPasswordReset(session.userId, targetUserUuid);

  const target = await findAccountByUuid(targetUserUuid);
  if (!target || target.tenant.type !== TenantType.SUB) {
    throw validationError("User not found");
  }

  const rawToken = randomToken(32);
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS);

  await prisma.$transaction([
    prisma.userPasswordResetToken.updateMany({
      where: { userUuid: target.uuid, usedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
    prisma.userPasswordResetToken.create({
      data: {
        userUuid: target.uuid,
        tokenHash,
        expiresAt,
        createdByUuid: session.userId,
      },
    }),
  ]);

  const baseUrl = (process.env.TENANT_APP_URL ?? "http://localhost:3001").replace(
    /\/$/,
    "",
  );
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
  const tokenHash = hashToken(token);
  const row = await prisma.userPasswordResetToken.findUnique({
    where: { tokenHash },
  });
  if (!row || row.usedAt || row.revokedAt || row.expiresAt < new Date()) {
    throw unauthenticated("Invalid or expired reset link");
  }
  return { valid: true as const, expiresAt: row.expiresAt.toISOString() };
}

export async function completePasswordReset(input: {
  token: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
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

  const tokenHash = hashToken(input.token);
  const row = await prisma.userPasswordResetToken.findUnique({
    where: { tokenHash },
  });
  if (!row || row.usedAt || row.revokedAt || row.expiresAt < new Date()) {
    throw unauthenticated("Invalid or expired reset link");
  }

  const account = await findAccountByUuid(row.userUuid);
  if (!account || account.status !== UserStatus.ACTIVE) {
    throw unauthenticated("Invalid or expired reset link");
  }

  const providedName =
    input.firstName != null || input.lastName != null
      ? `${input.firstName ?? ""} ${input.lastName ?? ""}`.trim()
      : (input.fullName ?? "");
  if (!providedName || normalizeName(providedName) !== normalizeName(account.fullName)) {
    throw validationError("Name does not match this account");
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

    await tx.user.update({
      where: { uuid: row.userUuid },
      data: { passwordHash },
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
    metadata: { userUuid: row.userUuid },
  });

  return { success: true as const };
}
