import {
  MembershipStatus,
  TenantType,
  UserStatus,
} from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/src/lib/db";
import type { SessionPayload } from "@/src/lib/auth/session";
import { forbidden, validationError } from "@/src/lib/errors";
import { createActivationToken } from "@/src/modules/auth/activation.service";
import { generateSubTenantUserPasswordResetLink } from "@/src/modules/auth/password-reset.service";
import { writeAuthAudit } from "@/src/modules/auth/audit-auth";
import {
  findAccountByUuid,
  getRoleUuid,
  mapAuthUser,
} from "@/src/modules/users/account";
import {
  requireTenantUserPermission,
  type TenantUserPermission,
} from "@/src/modules/roles/role-permission.service";
import {
  requireManagedSubTenantUser,
  requireTenantAdminTarget,
} from "@/src/modules/tenants/tenant-user-access.service";

const namePart = z.string().trim().min(1).max(60);
const createTenantUserSchema = z.object({
  email: z.string().trim().email().max(254),
  firstName: namePart,
  lastName: namePart,
  role: z.enum(["ADMIN", "EDITOR"]).default("ADMIN"),
  tenantId: z.string().uuid().optional(),
});

const tenantUserUpdateSchema = z.object({
  email: z.string().trim().email().max(254).optional(),
  firstName: z.string().trim().min(1).max(60).optional(),
  lastName: z.string().trim().min(1).max(60).optional(),
  role: z.enum(["ADMIN", "EDITOR"]).optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
  suspended: z.boolean().optional(),
});

export async function updateTenantUser(session: SessionPayload, userId: string, input: unknown) {
  const parsed = tenantUserUpdateSchema.safeParse(input);
  if (!parsed.success) throw validationError(parsed.error.issues[0]?.message ?? "Invalid input");
  if (userId === session.userId) {
    await requireTenantUserPermission(session, "USERS_EDIT");
    const ownMembership = await prisma.tenantMembership.findFirst({
      where: {
        tenantUuid: session.tenantId,
        userUuid: session.userId,
        status: MembershipStatus.ACTIVE,
        role: { code: { in: ["ADMIN", "EDITOR"] } },
        tenant: { type: TenantType.SUB },
        user: { deletedAt: null, status: UserStatus.ACTIVE },
      },
      select: { uuid: true },
    });
    if (!ownMembership) throw forbidden("You do not have access to manage this tenant");
    if (parsed.data.role || parsed.data.status) {
      throw validationError("You cannot change your own role or account status");
    }
    if (parsed.data.email) {
      const email = parsed.data.email.toLowerCase();
      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing && existing.uuid !== session.userId) throw validationError("Email already in use");
    }
    await prisma.user.update({ where: { uuid: session.userId }, data: { ...(parsed.data.email ? { email: parsed.data.email.toLowerCase() } : {}), ...(parsed.data.firstName ? { firstName: parsed.data.firstName } : {}), ...(parsed.data.lastName ? { lastName: parsed.data.lastName } : {}) } });
    await writeAuthAudit({ action: "TENANT_USER_UPDATED", actorUserUuid: session.userId, tenantUuid: session.tenantId, targetType: "user", targetUuid: session.userId, metadata: { changed: Object.keys(parsed.data), selfServiceProfile: true } });
    const account = await findAccountByUuid(session.userId, session.tenantId);
    if (!account) throw validationError("User not found");
    return { ...mapAuthUser(account), createdAt: null, lastLoginAt: null, totpEnabled: Boolean(account.totpEnabledAt) };
  }
  const updatePermission: TenantUserPermission = parsed.data.role
    ? "USERS_CHANGE_ROLE"
    : parsed.data.suspended !== undefined || parsed.data.status === "INACTIVE"
      ? "USERS_SUSPEND"
      : "USERS_EDIT";
  const membership = await requireTenantAdminTarget(session, userId, updatePermission);
  if (
    (parsed.data.email || parsed.data.firstName || parsed.data.lastName) &&
    updatePermission !== "USERS_EDIT"
  ) {
    await requireTenantUserPermission(session, "USERS_EDIT");
  }
  if (parsed.data.role && (parsed.data.suspended || parsed.data.status === "INACTIVE")) {
    await requireTenantUserPermission(session, "USERS_SUSPEND");
  }
  if (parsed.data.email && parsed.data.email.toLowerCase() !== membership.user.email) {
    const exists = await prisma.user.findUnique({ where: { email: parsed.data.email.toLowerCase() } });
    if (exists) throw validationError("Email already in use");
  }
  if (membership.role.code === "ADMIN" && (parsed.data.role === "EDITOR" || parsed.data.suspended || parsed.data.status === "INACTIVE")) {
    const activeAdmins = await prisma.tenantMembership.count({ where: { tenantUuid: session.tenantId, status: MembershipStatus.ACTIVE, role: { code: "ADMIN" }, user: { status: UserStatus.ACTIVE, deletedAt: null } } });
    if (membership.user.status === UserStatus.ACTIVE && membership.status === MembershipStatus.ACTIVE && activeAdmins <= 1) throw validationError("Cannot remove the last active tenant Admin");
  }
  await prisma.$transaction(async (tx) => {
    if (parsed.data.role) await tx.tenantMembership.update({ where: { uuid: membership.uuid }, data: { roleUuid: await getRoleUuid(parsed.data.role) } });
    if (parsed.data.suspended !== undefined) await tx.tenantMembership.update({ where: { uuid: membership.uuid }, data: { status: parsed.data.suspended ? MembershipStatus.DISABLED : MembershipStatus.ACTIVE } });
    await tx.user.update({ where: { uuid: userId }, data: { ...(parsed.data.email ? { email: parsed.data.email.toLowerCase() } : {}), ...(parsed.data.firstName ? { firstName: parsed.data.firstName } : {}), ...(parsed.data.lastName ? { lastName: parsed.data.lastName } : {}), ...(parsed.data.status ? { status: parsed.data.status as UserStatus } : {}) } });
    if (parsed.data.suspended || parsed.data.status === "INACTIVE") await tx.userSession.updateMany({ where: { userUuid: userId, tenantUuid: session.tenantId, revokedAt: null }, data: { revokedAt: new Date() } });
  });
  await writeAuthAudit({ action: "TENANT_USER_UPDATED", actorUserUuid: session.userId, tenantUuid: session.tenantId, targetType: "user", targetUuid: userId, metadata: { changed: Object.keys(parsed.data) } });
  const account = await findAccountByUuid(userId, session.tenantId, true);
  if (!account) throw validationError("User not found");
  return { ...mapAuthUser(account), createdAt: null, lastLoginAt: null, totpEnabled: Boolean(account.totpEnabledAt) };
}

export async function generateTenantUserPasswordResetLink(session: SessionPayload, userId: string) {
  await requireTenantAdminTarget(session, userId, "USERS_RESET_PASSWORD");
  return generateSubTenantUserPasswordResetLink(session, userId);
}

/**
 * Delete a suspended user and their account from the database.
 */
export async function deleteTenantUser(
  session: SessionPayload,
  userId: string,
) {
  await requireTenantUserPermission(session, "USERS_DELETE");

  const membership = await prisma.tenantMembership.findFirst({
    where: {
      tenantUuid: session.tenantId,
      userUuid: userId,
      status: { in: [MembershipStatus.ACTIVE, MembershipStatus.DISABLED] },
      role: { code: { in: ["ADMIN", "EDITOR"] } },
      tenant: { type: TenantType.SUB },
      user: { deletedAt: null },
    },
    select: {
      uuid: true,
      userUuid: true,
      status: true,
      user: { select: { email: true } },
      role: { select: { code: true } },
    },
  });
  if (!membership) throw validationError("User not found");
  if (membership.userUuid === session.userId) {
    throw validationError("You cannot remove your own access");
  }
  if (membership.status !== MembershipStatus.DISABLED) {
    throw validationError("Suspend this tenant user before deleting them");
  }

  const now = new Date();
  const deletedFromDatabase = await prisma.$transaction(async (tx) => {
    // Serialize membership deletion with the active-membership check below.
    await tx.$queryRaw`WITH tenant_roster_lock AS MATERIALIZED (
      SELECT pg_advisory_xact_lock(hashtext(${session.tenantId}), 2)
    )
    SELECT 1 AS locked FROM tenant_roster_lock`;

    const current = await tx.tenantMembership.findFirst({
      where: {
        uuid: membership.uuid,
        tenantUuid: session.tenantId,
        status: MembershipStatus.DISABLED,
        role: { code: { in: ["ADMIN", "EDITOR"] } },
        tenant: { type: TenantType.SUB },
        user: { deletedAt: null },
      },
      select: {
        uuid: true,
        userUuid: true,
        role: { select: { code: true } },
        user: { select: { status: true } },
      },
    });
    if (!current) throw validationError("User not found");

    await tx.tenantMembership.delete({ where: { uuid: current.uuid } });
    await tx.userSession.updateMany({
      where: {
        userUuid: current.userUuid,
        tenantUuid: session.tenantId,
        revokedAt: null,
      },
      data: { revokedAt: now },
    });

    // User-owned records and memberships cascade from this hard delete.
    await tx.user.delete({ where: { uuid: current.userUuid } });
    return true;
  });

  await writeAuthAudit({
    action: "TENANT_USER_REMOVED",
    actorUserUuid: session.userId,
    tenantUuid: session.tenantId,
    targetType: "user",
    targetUuid: membership.userUuid,
    metadata: {
      email: membership.user.email,
      role: membership.role.code,
      membershipUuid: membership.uuid,
      deletedFromDatabase,
    },
  });

  return true;
}

export async function updateManagedSubTenantUser(
  session: SessionPayload,
  tenantId: string,
  userId: string,
  input: unknown,
) {
  const parsed = tenantUserUpdateSchema.safeParse(input);
  if (!parsed.success) throw validationError(parsed.error.issues[0]?.message ?? "Invalid input");
  const permission: TenantUserPermission = parsed.data.role
    ? "USERS_CHANGE_ROLE"
    : parsed.data.suspended !== undefined || parsed.data.status === "INACTIVE"
      ? "USERS_SUSPEND"
      : "USERS_EDIT";
  const membership = await requireManagedSubTenantUser(session, tenantId, userId, permission);
  if ((parsed.data.email || parsed.data.firstName || parsed.data.lastName) && permission !== "USERS_EDIT") {
    await requireTenantUserPermission(session, "USERS_EDIT");
  }
  if (parsed.data.role && (parsed.data.suspended || parsed.data.status === "INACTIVE")) {
    await requireTenantUserPermission(session, "USERS_SUSPEND");
  }
  if (parsed.data.email && parsed.data.email.toLowerCase() !== membership.user.email) {
    const exists = await prisma.user.findUnique({ where: { email: parsed.data.email.toLowerCase() }, select: { uuid: true } });
    if (exists) throw validationError("Email already in use");
  }
  if (membership.role.code === "ADMIN" && (parsed.data.role === "EDITOR" || parsed.data.suspended || parsed.data.status === "INACTIVE")) {
    const activeAdmins = await prisma.tenantMembership.count({ where: { tenantUuid: membership.tenantId, status: MembershipStatus.ACTIVE, role: { code: "ADMIN" }, user: { status: UserStatus.ACTIVE, deletedAt: null } } });
    if (membership.status === MembershipStatus.ACTIVE && membership.user.status === UserStatus.ACTIVE && activeAdmins <= 1) {
      throw validationError("Cannot remove the last active tenant Admin");
    }
  }
  await prisma.$transaction(async (tx) => {
    if (parsed.data.role) await tx.tenantMembership.update({ where: { uuid: membership.uuid }, data: { roleUuid: await getRoleUuid(parsed.data.role) } });
    if (parsed.data.suspended !== undefined) await tx.tenantMembership.update({ where: { uuid: membership.uuid }, data: { status: parsed.data.suspended ? MembershipStatus.DISABLED : MembershipStatus.ACTIVE } });
    await tx.user.update({ where: { uuid: membership.userUuid }, data: { ...(parsed.data.email ? { email: parsed.data.email.toLowerCase() } : {}), ...(parsed.data.firstName ? { firstName: parsed.data.firstName } : {}), ...(parsed.data.lastName ? { lastName: parsed.data.lastName } : {}), ...(parsed.data.status ? { status: parsed.data.status as UserStatus } : {}) } });
    if (parsed.data.suspended || parsed.data.status === "INACTIVE") await tx.userSession.updateMany({ where: { userUuid: membership.userUuid, tenantUuid: membership.tenantId, revokedAt: null }, data: { revokedAt: new Date() } });
  });
  await writeAuthAudit({ action: "MANAGED_SUB_TENANT_USER_UPDATED", actorUserUuid: session.userId, tenantUuid: membership.tenantId, targetType: "user", targetUuid: membership.userUuid, metadata: { changed: Object.keys(parsed.data) } });
  const account = await findAccountByUuid(membership.userUuid, membership.tenantId, true);
  if (!account) throw validationError("User not found");
  return { ...mapAuthUser(account), createdAt: null, lastLoginAt: null, totpEnabled: Boolean(account.totpEnabledAt) };
}

export async function generateManagedSubTenantUserPasswordResetLink(session: SessionPayload, tenantId: string, userId: string) {
  const membership = await requireManagedSubTenantUser(session, tenantId, userId, "USERS_RESET_PASSWORD");
  return generateSubTenantUserPasswordResetLink(session, membership.userUuid);
}

export async function deleteManagedSubTenantUser(session: SessionPayload, tenantId: string, userId: string) {
  const membership = await requireManagedSubTenantUser(session, tenantId, userId, "USERS_DELETE");
  if (membership.status !== MembershipStatus.DISABLED) {
    throw validationError("Suspend this tenant user before deleting them");
  }
  const deletedFromDatabase = await prisma.$transaction(async (tx) => {
    await tx.tenantMembership.delete({ where: { uuid: membership.uuid } });
    // User-owned records and memberships cascade from this hard delete.
    await tx.user.delete({ where: { uuid: membership.userUuid } });
    return true;
  });
  await writeAuthAudit({
    action: "MANAGED_SUB_TENANT_USER_DELETED",
    actorUserUuid: session.userId,
    tenantUuid: membership.tenantId,
    targetType: "user",
    targetUuid: membership.userUuid,
    metadata: {
      email: membership.user.email,
      membershipUuid: membership.uuid,
      deletedFromDatabase,
    },
  });
  return true;
}

/**
 * SuperAdmin: create sub-tenant user (PENDING + activation).
 * Tenant Admin: omit tenantId — uses session tenant.
 */
export async function createAdminUser(
  session: SessionPayload,
  input: {
    email: string;
    firstName: string;
    lastName: string;
    role?: "ADMIN" | "EDITOR";
    tenantId?: string;
  },
) {
  const parsed = createTenantUserSchema.safeParse({
    email: input.email,
    firstName: input.firstName,
    lastName: input.lastName,
    role: input.role ?? "ADMIN",
    tenantId: input.tenantId,
  });
  if (!parsed.success) {
    throw validationError(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  let tenantUuid: string;
  if (session.role === "SUPERADMIN") {
    if (!parsed.data.tenantId) {
      throw validationError("tenantId is required");
    }
    await requireTenantUserPermission(session, "USERS_CREATE");
    if (parsed.data.role !== "EDITOR") {
      await requireTenantUserPermission(session, "USERS_CHANGE_ROLE");
    }
    tenantUuid = parsed.data.tenantId;
  } else {
    await requireTenantUserPermission(session, "USERS_CREATE");
    if (parsed.data.role !== "EDITOR") {
      await requireTenantUserPermission(session, "USERS_CHANGE_ROLE");
    }
    tenantUuid = session.tenantId;
  }

  const tenant = await prisma.tenant.findUnique({
    where: { uuid: tenantUuid },
  });
  if (!tenant || tenant.type !== TenantType.SUB) {
    throw validationError("Sub-tenant users must be created under a sub-tenant");
  }

  const roleCode = parsed.data.role;
  const roleUuid = await getRoleUuid(roleCode);
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
        tenantUuid: tenant.uuid,
        roleUuid,
        status: MembershipStatus.ACTIVE,
        createdByUuid: session.userId,
      },
    });
    const activationLink = await createActivationToken(
      {
        userUuid: created.uuid,
        createdByUuid: session.userId,
        tenantUuid: tenant.uuid,
        audience: "TENANT_APP",
      },
      tx,
    );
    await writeAuthAudit(
      {
        action: roleCode === "EDITOR" ? "EDITOR_CREATED" : "ADMIN_CREATED",
        actorUserUuid: session.userId,
        tenantUuid: session.tenantId,
        targetType: "user",
        targetUuid: created.uuid,
        metadata: {
          email: created.email,
          role: roleCode,
          tenantUuid: tenant.uuid,
        },
      },
      tx,
    );
    return { user: created, activation: activationLink };
  });

  const account = await findAccountByUuid(user.uuid, tenant.uuid);
  if (!account) throw validationError("Failed to load created user");

  return {
    user: {
      ...mapAuthUser(account),
      createdAt: user.createdAt.toISOString(),
      lastLoginAt: null,
      totpEnabled: false,
    },
    activationUrl: activation.activationUrl,
    expiresAt: activation.expiresAt,
  };
}
