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
import { createActivationToken } from "@/src/modules/auth/activation.service";
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
  status: z.enum(["ACTIVE", "LOCKED", "DISABLED", "PENDING"]).optional(),
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

async function countActiveSuperAdmins() {
  return prisma.tenantMembership.count({
    where: {
      status: MembershipStatus.ACTIVE,
      role: { code: "SUPERADMIN" },
      tenant: { type: TenantType.MAIN },
      user: { status: UserStatus.ACTIVE, deletedAt: null },
    },
  });
}

async function mapMainRow(userUuid: string) {
  const account = await findAccountByUuid(userUuid);
  if (!account) throw validationError("User not found");
  const mapped = mapAuthUser(account);
  return {
    ...mapped,
    createdAt: (
      await prisma.user.findUniqueOrThrow({ where: { uuid: userUuid } })
    ).createdAt.toISOString(),
    lastLoginAt: (
      await prisma.user.findUniqueOrThrow({ where: { uuid: userUuid } })
    ).lastLoginAt?.toISOString() ?? null,
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
      include: { user: true },
      orderBy: { createdAt: "desc" },
      skip: (parsed.data.page - 1) * parsed.data.pageSize,
      take: parsed.data.pageSize,
    }),
    prisma.tenantMembership.count({ where }),
  ]);

  const items = await Promise.all(rows.map((r) => mapMainRow(r.userUuid)));
  return {
    items,
    total,
    page: parsed.data.page,
    pageSize: parsed.data.pageSize,
  };
}

export async function getMainTenantUser(session: SessionPayload, userId: string) {
  await requireSuperAdmin(session);
  const account = await findAccountByUuid(userId);
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

  const user = await prisma.$transaction(async (tx) => {
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
    return created;
  });

  const activation = await createActivationToken({
    userUuid: user.uuid,
    createdByUuid: session.userId,
  });

  await writeAuthAudit({
    action: "MAIN_USER_CREATED",
    actorUserUuid: session.userId,
    tenantUuid: session.tenantId,
    targetType: "user",
    targetUuid: user.uuid,
    metadata: { email: user.email, role: "SUPERADMIN" },
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
  },
) {
  await requireSuperAdmin(session);
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) {
    throw validationError(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const existing = await findAccountByUuid(userId);
  if (
    !existing ||
    existing.tenant.type !== TenantType.MAIN ||
    existing.roleCode !== "SUPERADMIN"
  ) {
    throw validationError("User not found");
  }

  if (parsed.data.status && parsed.data.status !== UserStatus.ACTIVE) {
    assertCanRemoveLastActiveSuperAdmin({
      targetUserId: existing.uuid,
      actorUserId: session.userId,
      targetStatus: existing.status,
      nextStatus: parsed.data.status,
      activeSuperAdminCount: await countActiveSuperAdmins(),
    });
  }

  if (parsed.data.email) {
    const email = parsed.data.email.toLowerCase();
    if (email !== existing.email) {
      const clash = await prisma.user.findUnique({ where: { email } });
      if (clash) throw validationError("Email already in use");
    }
  }

  await prisma.user.update({
    where: { uuid: existing.uuid },
    data: {
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
    },
  });

  if (
    parsed.data.status !== undefined &&
    parsed.data.status !== UserStatus.ACTIVE &&
    existing.status === UserStatus.ACTIVE
  ) {
    await revokeAllUserSessions(existing.uuid);
    await prisma.userActivationToken.updateMany({
      where: { userUuid: existing.uuid, usedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
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
  const existing = await findAccountByUuid(userId);
  if (
    !existing ||
    existing.tenant.type !== TenantType.MAIN ||
    existing.roleCode !== "SUPERADMIN"
  ) {
    throw validationError("User not found");
  }

  assertCanRemoveLastActiveSuperAdmin({
    targetUserId: existing.uuid,
    actorUserId: session.userId,
    targetStatus: existing.status,
    activeSuperAdminCount: await countActiveSuperAdmins(),
  });

  await prisma.user.update({
    where: { uuid: existing.uuid },
    data: {
      status: UserStatus.DISABLED,
      deletedAt: new Date(),
    },
  });
  await revokeAllUserSessions(existing.uuid);
  await prisma.userActivationToken.updateMany({
    where: { userUuid: existing.uuid, usedAt: null, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  await prisma.userPasswordResetToken.updateMany({
    where: { userUuid: existing.uuid, usedAt: null, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  await writeAuthAudit({
    action: "MAIN_USER_DELETED",
    actorUserUuid: session.userId,
    tenantUuid: session.tenantId,
    targetType: "user",
    targetUuid: existing.uuid,
    metadata: { email: existing.email, fullName: displayFullName(existing) },
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
  if (existing.totpEnabledAt && existing.status === UserStatus.ACTIVE) {
    throw validationError("User is already activated; use password reset instead");
  }

  const activation = await createActivationToken({
    userUuid: existing.uuid,
    createdByUuid: session.userId,
  });

  await writeAuthAudit({
    action: "auth.activation.link_generated",
    actorUserUuid: session.userId,
    tenantUuid: session.tenantId,
    targetType: "user",
    targetUuid: existing.uuid,
  });

  return {
    activationUrl: activation.activationUrl,
    expiresAt: activation.expiresAt,
    user: await mapMainRow(existing.uuid),
  };
}

export { generateMainTenantUserPasswordResetLink };
