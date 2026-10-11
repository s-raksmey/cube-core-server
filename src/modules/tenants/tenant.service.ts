import {
  MembershipStatus,
  Prisma,
  TenantStatus,
  TenantType,
  UserStatus,
} from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/src/lib/db";
import type { SessionPayload } from "@/src/lib/auth/session";
import { forbidden, validationError } from "@/src/lib/errors";
import { createActivationToken } from "@/src/modules/auth/activation.service";
import { writeAuthAudit } from "@/src/modules/auth/audit-auth";
import {
  displayFullName,
  getMainTenant,
  getRoleUuid,
  mapAuthUser,
  findAccountByUuid,
} from "@/src/modules/users/account";

const createSubTenantSchema = z.object({
  name: z.string().trim().min(2).max(80),
  slug: z
    .string()
    .trim()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must be lowercase kebab-case"),
});

const namePart = z.string().trim().min(1).max(60);
const createTenantUserSchema = z.object({
  email: z.string().trim().email().max(254),
  firstName: namePart,
  lastName: namePart,
  role: z.enum(["ADMIN", "EDITOR"]).default("ADMIN"),
  tenantId: z.string().uuid().optional(),
});

function mapTenant(tenant: {
  uuid: string;
  name: string;
  slug: string;
  type: TenantType;
  status: TenantStatus;
  createdAt: Date;
}) {
  return {
    id: tenant.uuid,
    uuid: tenant.uuid,
    name: tenant.name,
    slug: tenant.slug,
    type: tenant.type,
    status: tenant.status,
    createdAt: tenant.createdAt.toISOString(),
  };
}

async function requireSuperAdmin(session: SessionPayload) {
  if (session.role !== "SUPERADMIN") {
    throw forbidden("SuperAdmin only");
  }
}

async function requireTenantAdmin(session: SessionPayload) {
  if (session.role !== "ADMIN" && session.role !== "SUPERADMIN") {
    throw forbidden("Admin only");
  }
}

export async function createSubTenant(
  session: SessionPayload,
  input: { name: string; slug: string },
) {
  await requireSuperAdmin(session);
  const parsed = createSubTenantSchema.safeParse(input);
  if (!parsed.success) {
    throw validationError(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const mainTenant = await getMainTenant();

  const existing = await prisma.tenant.findUnique({
    where: { slug: parsed.data.slug },
  });
  if (existing) {
    throw validationError("Slug already exists");
  }

  const tenant = await prisma.tenant.create({
    data: {
      type: TenantType.SUB,
      parentTenantUuid: mainTenant.uuid,
      name: parsed.data.name,
      slug: parsed.data.slug,
      status: TenantStatus.ACTIVE,
    },
  });

  await writeAuthAudit({
    action: "SUB_TENANT_CREATED",
    actorUserUuid: session.userId,
    tenantUuid: session.tenantId,
    targetType: "tenant",
    targetUuid: tenant.uuid,
    metadata: { slug: tenant.slug, name: tenant.name },
  });

  return mapTenant(tenant);
}

export async function setSubTenantStatus(
  session: SessionPayload,
  input: { tenantId: string; status: TenantStatus },
) {
  await requireSuperAdmin(session);

  const tenant = await prisma.tenant.findUnique({
    where: { uuid: input.tenantId },
  });
  if (!tenant || tenant.type !== TenantType.SUB) {
    throw validationError("Sub-tenant not found");
  }

  const updated = await prisma.tenant.update({
    where: { uuid: tenant.uuid },
    data: { status: input.status },
  });

  await writeAuthAudit({
    action:
      input.status === TenantStatus.SUSPENDED
        ? "SUB_TENANT_SUSPENDED"
        : "SUB_TENANT_REACTIVATED",
    actorUserUuid: session.userId,
    tenantUuid: session.tenantId,
    targetType: "tenant",
    targetUuid: tenant.uuid,
    metadata: { status: input.status },
  });

  return mapTenant(updated);
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
    tenantUuid = parsed.data.tenantId;
  } else {
    await requireTenantAdmin(session);
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

export async function listSubTenants(
  session: SessionPayload,
  input?: { search?: string; page?: number; pageSize?: number },
) {
  await requireSuperAdmin(session);
  const page = Math.max(1, input?.page ?? 1);
  const pageSize = Math.min(50, Math.max(1, input?.pageSize ?? 10));
  const search = input?.search?.trim();

  const where: Prisma.TenantWhereInput = {
    type: TenantType.SUB,
    deletedAt: null,
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" as const } },
            { slug: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.tenant.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.tenant.count({ where }),
  ]);

  return {
    items: items.map(mapTenant),
    total,
    page,
    pageSize,
  };
}

export async function listTenantUsers(
  session: SessionPayload,
  input?: { search?: string; page?: number; pageSize?: number },
) {
  if (
    session.role !== "ADMIN" &&
    session.role !== "EDITOR" &&
    session.role !== "SUPERADMIN"
  ) {
    throw forbidden();
  }

  const page = Math.max(1, input?.page ?? 1);
  const pageSize = Math.min(50, Math.max(1, input?.pageSize ?? 10));
  const search = input?.search?.trim();

  const where: Prisma.TenantMembershipWhereInput = {
    tenantUuid: session.tenantId,
    status: MembershipStatus.ACTIVE,
    role: { code: { in: ["ADMIN", "EDITOR"] } },
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
        role: { select: { code: true } },
        tenant: {
          select: {
            uuid: true,
            name: true,
            slug: true,
            type: true,
            status: true,
            createdAt: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.tenantMembership.count({ where }),
  ]);

  return {
    items: rows.map((row) => ({
      id: row.user.uuid,
      uuid: row.user.uuid,
      email: row.user.email,
      username: row.user.username,
      firstName: row.user.firstName,
      lastName: row.user.lastName,
      fullName: displayFullName(row.user),
      type: "SUB" as const,
      role: row.role.code,
      status: row.user.status,
      tenantId: row.tenant.uuid,
      tenant: mapTenant(row.tenant),
      createdAt: row.user.createdAt.toISOString(),
      lastLoginAt: row.user.lastLoginAt?.toISOString() ?? null,
      totpEnabled: Boolean(row.user.twoFactorAuth?.enabledAt),
    })),
    total,
    page,
    pageSize,
  };
}

/** Remove a user's access from the current sub-tenant without hard-deleting identity data. */
export async function deleteTenantUser(
  session: SessionPayload,
  userId: string,
) {
  if (session.role !== "ADMIN") {
    throw forbidden("Only tenant Admins can remove users");
  }

  const membership = await prisma.tenantMembership.findFirst({
    where: {
      tenantUuid: session.tenantId,
      userUuid: userId,
      status: MembershipStatus.ACTIVE,
      role: { code: { in: ["ADMIN", "EDITOR"] } },
      tenant: { type: TenantType.SUB },
      user: { deletedAt: null },
    },
    select: {
      uuid: true,
      userUuid: true,
      user: { select: { email: true } },
      role: { select: { code: true } },
    },
  });
  if (!membership) throw validationError("User not found");
  if (membership.userUuid === session.userId) {
    throw validationError("You cannot remove your own access");
  }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    // Serialize Admin removals for this tenant to protect the last-Admin rule
    // from concurrent requests.
    // Return a scalar row from the CTE; Prisma cannot deserialize the lock
    // function's PostgreSQL `void` result directly.
    await tx.$queryRaw`WITH tenant_roster_lock AS MATERIALIZED (
      SELECT pg_advisory_xact_lock(hashtext(${session.tenantId}), 2)
    )
    SELECT 1 AS locked FROM tenant_roster_lock`;

    const current = await tx.tenantMembership.findFirst({
      where: {
        uuid: membership.uuid,
        tenantUuid: session.tenantId,
        status: MembershipStatus.ACTIVE,
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

    if (
      current.role.code === "ADMIN" &&
      current.user.status === UserStatus.ACTIVE
    ) {
      const activeAdminCount = await tx.tenantMembership.count({
        where: {
          tenantUuid: session.tenantId,
          status: MembershipStatus.ACTIVE,
          role: { code: "ADMIN" },
          user: { status: UserStatus.ACTIVE, deletedAt: null },
        },
      });
      if (activeAdminCount <= 1) {
        throw validationError("Cannot remove the last active tenant Admin");
      }
    }

    await tx.tenantMembership.update({
      where: { uuid: current.uuid },
      data: { status: MembershipStatus.DISABLED },
    });
    await tx.userSession.updateMany({
      where: {
        userUuid: current.userUuid,
        tenantUuid: session.tenantId,
        revokedAt: null,
      },
      data: { revokedAt: now },
    });

    const hasOtherActiveMembership =
      (await tx.tenantMembership.count({
        where: {
          userUuid: current.userUuid,
          status: MembershipStatus.ACTIVE,
        },
      })) > 0;

    if (!hasOtherActiveMembership) {
      await tx.user.update({
        where: { uuid: current.userUuid },
        data: {
          status: UserStatus.INACTIVE,
          deletedAt: now,
          sessionsRevokedAt: now,
        },
      });
      await tx.userSession.updateMany({
        where: { userUuid: current.userUuid, revokedAt: null },
        data: { revokedAt: now },
      });
      await tx.userActivationToken.updateMany({
        where: {
          userUuid: current.userUuid,
          usedAt: null,
          revokedAt: null,
        },
        data: { revokedAt: now, encryptedToken: null },
      });
      await tx.userPasswordResetToken.updateMany({
        where: {
          userUuid: current.userUuid,
          usedAt: null,
          revokedAt: null,
        },
        data: { revokedAt: now },
      });
    }
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
    },
  });

  return true;
}
