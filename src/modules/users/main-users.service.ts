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
import { revokeAllUserSessions } from "@/src/modules/auth/session.service";
import {
  displayFullName,
  getMainTenant,
  getRoleUuid,
  mapAuthUser,
  findAccountByUuid,
} from "@/src/modules/users/account";
import { generateMainTenantUserPasswordResetLink } from "@/src/modules/auth/password-reset.service";
import { requireTenantUserPermission } from "@/src/modules/roles/role-permission.service";

const namePart = z.string().trim().min(1).max(60);
const createSchema = z.object({
  email: z.string().trim().email().max(254),
  firstName: namePart,
  lastName: namePart,
});
const updateSchema = z.object({
  email: z.string().trim().email().max(254).optional(),
  firstName: namePart.optional(),
  lastName: namePart.optional(),
  status: z.enum(["ACTIVE", "LOCKED", "INACTIVE", "PENDING"]).optional(),
  suspended: z.boolean().optional(),
});
const listSchema = z.object({
  search: z.string().trim().max(120).optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(50).default(10),
});

export function assertCanRemoveLastActiveSuperAdmin(options: {
  targetUserId: string;
  actorUserId: string;
  targetStatus: UserStatus;
  nextStatus?: UserStatus;
  activeSuperAdminCount: number;
}) {
  if (options.targetUserId === options.actorUserId) {
    throw validationError("You cannot delete or disable your own account");
  }
  const disablingActive =
    options.targetStatus === UserStatus.ACTIVE &&
    (options.nextStatus === undefined ||
      options.nextStatus !== UserStatus.ACTIVE);
  if (disablingActive && options.activeSuperAdminCount <= 1) {
    throw validationError("Cannot remove the last active SuperAdmin account");
  }
}

async function requireSuperAdmin(session: SessionPayload) {
  if (session.role !== "SUPERADMIN") throw forbidden("SuperAdmin only");
}

async function lockSuperAdminRoster(tx: Prisma.TransactionClient) {
  // Serialize roster-removal checks so two concurrent requests cannot both
  // observe themselves as leaving one usable account behind.
  // Select a scalar from the lock CTE so Prisma doesn't try to deserialize
  // PostgreSQL's `void` return value from pg_advisory_xact_lock.
  await tx.$queryRaw`WITH roster_lock AS MATERIALIZED (
    SELECT pg_advisory_xact_lock(1129665109, 1)
  )
  SELECT 1 AS locked FROM roster_lock`;
}

async function countActiveSuperAdmins(client: typeof prisma | Prisma.TransactionClient = prisma) {
  return client.tenantMembership.count({
    where: {
      status: MembershipStatus.ACTIVE,
      role: { code: "SUPERADMIN" },
      tenant: { type: TenantType.MAIN },
      user: { status: UserStatus.ACTIVE, deletedAt: null },
    },
  });
}

async function mapMainRow(userUuid: string) {
  const account = await findAccountByUuid(userUuid, undefined, true);
  if (!account) throw validationError("User not found");
  const mapped = mapAuthUser(account);
  const user = await prisma.user.findUniqueOrThrow({
    where: { uuid: userUuid },
    select: { createdAt: true, lastLoginAt: true },
  });
  return {
    ...mapped,
    createdAt: user.createdAt.toISOString(),
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    totpEnabled: Boolean(account.totpEnabledAt),
  };
}

export async function listMainTenantUsers(
  session: SessionPayload,
  input?: { search?: string | null; page?: number | null; pageSize?: number | null },
) {
  await requireSuperAdmin(session);
  const parsed = listSchema.safeParse({
    search: input?.search ?? undefined,
    page: input?.page ?? 1,
    pageSize: input?.pageSize ?? 10,
  });
  if (!parsed.success) {
    throw validationError(parsed.error.issues[0]?.message ?? "Invalid input");
  }
  const mainTenant = await getMainTenant();
  const search = parsed.data.search;
  const where: Prisma.TenantMembershipWhereInput = {
    tenantUuid: mainTenant.uuid,
    role: { code: "SUPERADMIN" },
    user: {
      deletedAt: null,
      ...(search
        ? {
            OR: [
              { firstName: { contains: search, mode: "insensitive" } },
              { lastName: { contains: search, mode: "insensitive" } },
              { email: { contains: search, mode: "insensitive" } },
              { username: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    },
  };

  const [rows, total] = await Promise.all([
    prisma.tenantMembership.findMany({
      where,
      select: {
        status: true,
        user: {
          select: {
            uuid: true,
            email: true,
            username: true,
            firstName: true,
            lastName: true,
            status: true,
            createdAt: true,
            lastLoginAt: true,
            twoFactorAuth: { select: { enabledAt: true } },
          },
        },
        tenant: {
          select: {
            uuid: true,
            name: true,
            slug: true,
            type: true,
            status: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      skip: (parsed.data.page - 1) * parsed.data.pageSize,
      take: parsed.data.pageSize,
    }),
    prisma.tenantMembership.count({ where }),
  ]);

  const items = rows.map(({ user, tenant, status: membershipStatus }) => ({
    id: user.uuid,
    uuid: user.uuid,
    email: user.email,
    username: user.username,
    firstName: user.firstName,
    lastName: user.lastName,
    fullName: displayFullName(user),
    type: "MAIN" as const,
    role: "SUPERADMIN",
    status: user.status,
    membershipStatus,
    tenantId: tenant.uuid,
    tenant: {
      id: tenant.uuid,
      uuid: tenant.uuid,
      name: tenant.name,
      slug: tenant.slug,
      type: tenant.type,
      status: tenant.status,
    },
    createdAt: user.createdAt.toISOString(),
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    totpEnabled: Boolean(user.twoFactorAuth?.enabledAt),
  }));
  return {
    items,
    total,
    page: parsed.data.page,
    pageSize: parsed.data.pageSize,
  };
}

export async function getMainTenantUser(session: SessionPayload, userId: string) {
  await requireSuperAdmin(session);
  const account = await findAccountByUuid(userId, undefined, true);
  if (
    !account ||
    account.tenant.type !== TenantType.MAIN ||
    account.roleCode !== "SUPERADMIN"
  ) {
    throw validationError("User not found");
  }
  return mapMainRow(userId);
}

export async function createMainTenantUser(
  session: SessionPayload,
  input: { email: string; firstName: string; lastName: string },
) {
  await requireSuperAdmin(session);
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    throw validationError(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const mainTenant = await getMainTenant();
  const roleUuid = await getRoleUuid("SUPERADMIN");
  const email = parsed.data.email.toLowerCase();

  const exists = await prisma.user.findUnique({ where: { email } });
  if (exists) throw validationError("Email already in use");

  const { user, activation } = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        email,
        firstName: parsed.data.firstName,
        lastName: parsed.data.lastName,
        status: UserStatus.PENDING,
        createdByUuid: session.userId,
      },
    });
    await tx.tenantMembership.create({
      data: {
        userUuid: created.uuid,
        tenantUuid: mainTenant.uuid,
        roleUuid,
        status: MembershipStatus.ACTIVE,
        createdByUuid: session.userId,
      },
    });
    const activationLink = await createActivationToken(
      { userUuid: created.uuid, createdByUuid: session.userId },
      tx,
    );
    await writeAuthAudit(
      {
        action: "MAIN_USER_CREATED",
        actorUserUuid: session.userId,
        tenantUuid: session.tenantId,
        targetType: "user",
        targetUuid: created.uuid,
        metadata: { email: created.email, role: "SUPERADMIN" },
      },
      tx,
    );
    return { user: created, activation: activationLink };
  });

  return {
    user: await mapMainRow(user.uuid),
    activationUrl: activation.activationUrl,
    expiresAt: activation.expiresAt,
  };
}

export async function updateMainTenantUser(
  session: SessionPayload,
  userId: string,
  input: {
    email?: string;
    firstName?: string;
    lastName?: string;
    status?: UserStatus;
    suspended?: boolean;
  },
) {
  await requireSuperAdmin(session);
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) {
    throw validationError(parsed.error.issues[0]?.message ?? "Invalid input");
  }
  if (parsed.data.suspended !== undefined) {
    await requireTenantUserPermission(session, "USERS_SUSPEND");
  }

  const existing = await findAccountByUuid(userId, undefined, true);
  if (
    !existing ||
    existing.tenant.type !== TenantType.MAIN ||
    existing.roleCode !== "SUPERADMIN"
  ) {
    throw validationError("User not found");
  }

  const changesRemoveAvailability = parsed.data.suspended === true ||
    (parsed.data.status !== undefined && parsed.data.status !== UserStatus.ACTIVE);

  if (parsed.data.email) {
    const email = parsed.data.email.toLowerCase();
    if (email !== existing.email) {
      const clash = await prisma.user.findUnique({ where: { email } });
      if (clash) throw validationError("Email already in use");
    }
  }

  const updateData = {
      ...(parsed.data.firstName !== undefined
        ? { firstName: parsed.data.firstName }
        : {}),
      ...(parsed.data.lastName !== undefined
        ? { lastName: parsed.data.lastName }
        : {}),
      ...(parsed.data.email !== undefined
        ? { email: parsed.data.email.toLowerCase() }
        : {}),
      ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
      ...(parsed.data.status === UserStatus.ACTIVE
        ? {
            lockedUntil: null,
            failedPasswordAttempts: 0,
            failedTotpAttempts: 0,
          }
        : {}),
      ...(parsed.data.status === UserStatus.LOCKED &&
      existing.status !== UserStatus.LOCKED
        ? { lockedUntil: null }
        : {}),
    };

  if (changesRemoveAvailability) {
    await prisma.$transaction(async (tx) => {
      await lockSuperAdminRoster(tx);
      const current = await tx.user.findUnique({
        where: { uuid: existing.uuid },
        select: { status: true },
      });
      if (!current) throw validationError("User not found");
      assertCanRemoveLastActiveSuperAdmin({
        targetUserId: existing.uuid,
        actorUserId: session.userId,
        targetStatus: current.status,
        nextStatus: parsed.data.suspended ? UserStatus.INACTIVE : parsed.data.status,
        activeSuperAdminCount: await countActiveSuperAdmins(tx),
      });
      await tx.user.update({ where: { uuid: existing.uuid }, data: updateData });
      if (parsed.data.suspended !== undefined) await tx.tenantMembership.update({ where: { uuid: existing.membershipUuid }, data: { status: parsed.data.suspended ? MembershipStatus.DISABLED : MembershipStatus.ACTIVE } });
    });
  } else {
    await prisma.user.update({ where: { uuid: existing.uuid }, data: updateData });
    if (parsed.data.suspended !== undefined) await prisma.tenantMembership.update({ where: { uuid: existing.membershipUuid }, data: { status: parsed.data.suspended ? MembershipStatus.DISABLED : MembershipStatus.ACTIVE } });
  }

  if (
    parsed.data.suspended === true ||
    (parsed.data.status !== undefined &&
      parsed.data.status !== UserStatus.ACTIVE &&
      existing.status === UserStatus.ACTIVE)
  ) {
    await revokeAllUserSessions(existing.uuid);
    await prisma.userActivationToken.updateMany({
      where: { userUuid: existing.uuid, usedAt: null, revokedAt: null },
      data: { revokedAt: new Date(), encryptedToken: null },
    });
    await prisma.userPasswordResetToken.updateMany({
      where: { userUuid: existing.uuid, usedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  await writeAuthAudit({
    action: "MAIN_USER_UPDATED",
    actorUserUuid: session.userId,
    tenantUuid: session.tenantId,
    targetType: "user",
    targetUuid: existing.uuid,
    metadata: { changed: Object.keys(parsed.data) },
  });

  return mapMainRow(existing.uuid);
}

export async function deleteMainTenantUser(
  session: SessionPayload,
  userId: string,
) {
  await requireSuperAdmin(session);
  const existing = await findAccountByUuid(userId, undefined, true);
  if (
    !existing ||
    existing.tenant.type !== TenantType.MAIN ||
    existing.roleCode !== "SUPERADMIN"
  ) {
    throw validationError("User not found");
  }
  if (existing.membershipStatus !== MembershipStatus.DISABLED) {
    throw validationError("Suspend this user before deleting them");
  }

  await prisma.$transaction(async (tx) => {
    await lockSuperAdminRoster(tx);
    await tx.auditLog.create({
      data: {
        actorUserUuid: session.userId,
        tenantUuid: session.tenantId,
        action: "MAIN_USER_DELETED",
        targetType: "user",
        targetUuid: existing.uuid,
        metadata: {
          email: existing.email,
          fullName: displayFullName(existing),
          actorUserUuid: session.userId,
        },
      },
    });

    // Cascades remove the user's memberships, sessions, and authentication credentials.
    // Creator references on audit records and tokens are set null by their foreign keys.
    await tx.user.delete({ where: { uuid: existing.uuid } });
  });

  return true;
}

export async function generateMainTenantUserActivationLink(
  session: SessionPayload,
  userId: string,
) {
  await requireSuperAdmin(session);
  const existing = await findAccountByUuid(userId);
  if (
    !existing ||
    existing.tenant.type !== TenantType.MAIN ||
    existing.roleCode !== "SUPERADMIN"
  ) {
    throw validationError("User not found");
  }
  if (existing.uuid === session.userId) {
    throw validationError("You cannot reactivate your own account");
  }
  const activation = await prisma.$transaction(async (tx) => {
    const current = await tx.user.findUnique({
      where: { uuid: existing.uuid },
      include: { twoFactorAuth: true },
    });
    if (
      !current ||
      current.deletedAt ||
      (current.status !== UserStatus.PENDING &&
        current.status !== UserStatus.ACTIVE &&
        current.status !== UserStatus.LOCKED &&
        current.status !== UserStatus.INACTIVE)
    ) {
      throw validationError("This account cannot be reactivated");
    }

    const now = new Date();
    await tx.user.update({
      where: { uuid: current.uuid },
      data: {
        username: null,
        passwordHash: null,
        status: UserStatus.PENDING,
        activatedAt: null,
        failedPasswordAttempts: 0,
        failedTotpAttempts: 0,
        lockedUntil: null,
        sessionsRevokedAt: now,
      },
    });
    await tx.userTwoFactorAuth.updateMany({
      where: { userUuid: current.uuid },
      data: {
        encryptedSecret: null,
        pendingEncryptedSecret: null,
        pendingExpiresAt: null,
        enabledAt: null,
      },
    });
    await tx.authLoginChallenge.updateMany({
      where: {
        userUuid: current.uuid,
        consumedAt: null,
      },
      data: { consumedAt: now },
    });
    await tx.userRecoveryCode.deleteMany({ where: { userUuid: current.uuid } });
    await tx.userPasswordResetToken.updateMany({
      where: { userUuid: current.uuid, usedAt: null, revokedAt: null },
      data: { revokedAt: now },
    });
    await tx.userSession.updateMany({
      where: { userUuid: current.uuid, revokedAt: null },
      data: { revokedAt: now },
    });
    return createActivationToken(
      { userUuid: current.uuid, createdByUuid: session.userId },
      tx,
    );
  });

  await writeAuthAudit({
    action:
      existing.status === UserStatus.PENDING
        ? "auth.activation.restarted"
        : "auth.account.reactivated",
    actorUserUuid: session.userId,
    tenantUuid: session.tenantId,
    targetType: "user",
    targetUuid: existing.uuid,
    metadata: { previousStatus: existing.status },
  });

  return {
    activationUrl: activation.activationUrl,
    expiresAt: activation.expiresAt,
    user: await mapMainRow(existing.uuid),
  };
}

export async function getMainTenantUserActivationLink(
  session: SessionPayload,
  userId: string,
) {
  await requireSuperAdmin(session);
  const existing = await findAccountByUuid(userId);
  if (
    !existing ||
    existing.tenant.type !== TenantType.MAIN ||
    existing.roleCode !== "SUPERADMIN"
  ) {
    throw validationError("User not found");
  }

  const link = await getExistingActivationLink(existing.uuid);
  if (!link) return null;

  await writeAuthAudit({
    action: "auth.activation.link_viewed",
    actorUserUuid: session.userId,
    tenantUuid: session.tenantId,
    targetType: "user",
    targetUuid: existing.uuid,
  });
  return link;
}

export { generateMainTenantUserPasswordResetLink };
