import {
  MembershipStatus,
  Prisma,
  TenantType,
  UserStatus,
} from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/src/lib/db";
import type { SessionPayload } from "@/src/lib/auth/session";
import { forbidden, validationError } from "@/src/lib/errors";
import {
  createActivationToken,
  getExistingActivationLink,
} from "@/src/modules/auth/activation.service";
import { writeAuthAudit } from "@/src/modules/auth/audit-auth";
import {
  findAccountByUuid,
  mapAuthUser,
} from "@/src/modules/users/account";
import { requireTenantUserPermission } from "@/src/modules/roles/role-permission.service";
import {
  requireMainSuperAdmin,
  requireTenantAdminTarget,
} from "@/src/modules/tenants/tenant-user-access.service";
/** Return a currently valid tenant activation URL only to an authorized Main SuperAdmin. */
export async function getSubTenantUserActivationLink(
  session: SessionPayload,
  tenantId: string,
  userId: string,
) {
  if (session.role === "SUPERADMIN") {
    await requireMainSuperAdmin(session);
    await requireTenantUserPermission(session, "USERS_ACTIVATE");
  } else {
    if (session.audience !== "TENANT_APP" || session.tenantId !== tenantId) {
      throw forbidden("You can only view activation links for users in your own tenant");
    }
    await requireTenantUserPermission(session, "USERS_ACTIVATE");
  }
  const parsed = z.object({ tenantId: z.string().uuid(), userId: z.string().uuid() })
    .safeParse({ tenantId, userId });
  if (!parsed.success) {
    throw validationError(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const membership = await prisma.tenantMembership.findFirst({
    where: {
      tenantUuid: parsed.data.tenantId,
      userUuid: parsed.data.userId,
      status: MembershipStatus.ACTIVE,
      role: { code: { in: ["ADMIN", "EDITOR"] } },
      tenant: { type: TenantType.SUB, deletedAt: null },
      user: { deletedAt: null, status: UserStatus.PENDING, activatedAt: null },
    },
    select: { userUuid: true },
  });
  if (!membership) throw validationError("Pending user not found in this sub-tenant");

  const link = await getExistingActivationLink(membership.userUuid, {
    audience: "TENANT_APP",
    tenantUuid: parsed.data.tenantId,
  });
  if (!link) return null;

  await writeAuthAudit({
    action: "auth.activation.link_viewed",
    actorUserUuid: session.userId,
    tenantUuid: parsed.data.tenantId,
    targetType: "user",
    targetUuid: membership.userUuid,
    metadata: { audience: "TENANT_APP" },
  });
  return link;
}

/** Return the current valid activation link for a tenant Admin's managed user. */
export async function getTenantUserActivationLink(
  session: SessionPayload,
  userId: string,
) {
  await requireTenantAdminTarget(session, userId, "USERS_ACTIVATE");
  return getSubTenantUserActivationLink(session, session.tenantId, userId);
}

/** Regenerate a pending sub-tenant user's link; the row lock serializes concurrent requests. */
export async function regenerateSubTenantUserActivationLink(
  session: SessionPayload,
  tenantId: string,
  userId: string,
) {
  const parsed = z.object({ tenantId: z.string().uuid(), userId: z.string().uuid() })
    .safeParse({ tenantId, userId });
  if (!parsed.success) {
    throw validationError(parsed.error.issues[0]?.message ?? "Invalid input");
  }
  if (session.role === "SUPERADMIN") {
    await requireMainSuperAdmin(session);
    await requireTenantUserPermission(session, "USERS_ACTIVATE");
  } else {
    if (
      session.audience !== "TENANT_APP" ||
      parsed.data.tenantId !== session.tenantId
    ) {
      throw forbidden("You can only manage users in your own tenant");
    }
    await requireTenantUserPermission(session, "USERS_ACTIVATE");
  }

  const activation = await prisma.$transaction(async (tx) => {
    // Serializes re-issues for this account so only the final link remains valid.
    await tx.$queryRaw<Array<{ uuid: string }>>(
      Prisma.sql`SELECT uuid FROM users WHERE uuid = ${parsed.data.userId} FOR UPDATE`,
    );
    const membership = await tx.tenantMembership.findFirst({
      where: {
        tenantUuid: parsed.data.tenantId,
        userUuid: parsed.data.userId,
        status: MembershipStatus.ACTIVE,
        role: { code: { in: ["ADMIN", "EDITOR"] } },
        tenant: { type: TenantType.SUB, deletedAt: null },
        user: { deletedAt: null },
      },
      select: {
        user: { select: { uuid: true, status: true, activatedAt: true } },
      },
    });
    if (!membership) throw validationError("User not found in this sub-tenant");
    if (membership.user.status !== UserStatus.PENDING && membership.user.status !== UserStatus.ACTIVE) {
      throw validationError(
        "Activation links can only be generated for pending or active accounts.",
      );
    }

    const now = new Date();
    if (membership.user.status === UserStatus.ACTIVE) {
      await tx.user.update({ where: { uuid: membership.user.uuid }, data: { username: null, passwordHash: null, status: UserStatus.PENDING, activatedAt: null, failedPasswordAttempts: 0, failedTotpAttempts: 0, lockedUntil: null, sessionsRevokedAt: now } });
      await tx.userTwoFactorAuth.updateMany({ where: { userUuid: membership.user.uuid }, data: { encryptedSecret: null, pendingEncryptedSecret: null, pendingExpiresAt: null, enabledAt: null } });
      await tx.authLoginChallenge.updateMany({ where: { userUuid: membership.user.uuid, consumedAt: null }, data: { consumedAt: now } });
      await tx.userRecoveryCode.deleteMany({ where: { userUuid: membership.user.uuid } });
      await tx.userPasswordResetToken.updateMany({ where: { userUuid: membership.user.uuid, usedAt: null, revokedAt: null }, data: { revokedAt: now } });
      await tx.userSession.updateMany({ where: { userUuid: membership.user.uuid, tenantUuid: parsed.data.tenantId, revokedAt: null }, data: { revokedAt: now } });
    }

    const link = await createActivationToken(
      {
        userUuid: membership.user.uuid,
        createdByUuid: session.userId,
        tenantUuid: parsed.data.tenantId,
        audience: "TENANT_APP",
      },
      tx,
    );
    await writeAuthAudit(
      {
        action: membership.user.status === UserStatus.ACTIVE ? "auth.account.reactivated" : "auth.activation.link_regenerated",
        actorUserUuid: session.userId,
        tenantUuid: parsed.data.tenantId,
        targetType: "user",
        targetUuid: membership.user.uuid,
        metadata: { audience: "TENANT_APP" },
      },
      tx,
    );
    return link;
  });

  const account = await findAccountByUuid(userId, tenantId);
  if (!account) throw validationError("User not found");
  return {
    ...activation,
    user: {
      ...mapAuthUser(account),
      createdAt: null,
      lastLoginAt: null,
      totpEnabled: false,
    },
  };
}

export async function generateTenantUserActivationLink(session: SessionPayload, userId: string) {
  await requireTenantAdminTarget(session, userId, "USERS_ACTIVATE");
  return regenerateSubTenantUserActivationLink(session, session.tenantId, userId);
}

