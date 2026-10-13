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
import { displayFullName, getMainTenant } from "@/src/modules/users/account";
import { requireTenantUserPermission } from "@/src/modules/roles/role-permission.service";
import { mapTenant } from "@/src/modules/tenants/tenant.mapper";

async function requireMainSuperAdmin(session: SessionPayload) {
  if (session.role !== "SUPERADMIN") {
    throw forbidden("SuperAdmin only");
  }
  const mainTenant = await getMainTenant();
  if (session.tenantId !== mainTenant.uuid) {
    throw forbidden("SuperAdmin must use the Main Tenant session");
  }
}

const managedTenantUsersInputSchema = z.object({
  tenantId: z.string().uuid(),
  search: z.string().trim().max(100).nullish(),
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).max(50).optional(),
});
export function deriveActivationStatus(
  user: {
    status: UserStatus;
    activatedAt: Date | null;
    activationTokens: {
      createdAt: Date;
      expiresAt: Date;
      usedAt: Date | null;
      revokedAt: Date | null;
    }[];
  },
  now: Date,
) {
  if (user.status === UserStatus.INACTIVE) return "DISABLED" as const;
  if (user.activatedAt) return "ACTIVE" as const;
  const latest = user.activationTokens[0];
  if (
    latest &&
    !latest.usedAt &&
    !latest.revokedAt &&
    latest.expiresAt <= now
  ) {
    return "EXPIRED" as const;
  }
  return "PENDING" as const;
}

/** Main Console view of a single sub-tenant's users. */
export async function listManagedSubTenantUsers(
  session: SessionPayload,
  input: { tenantId: string; search?: string | null; page?: number; pageSize?: number },
) {
  await requireMainSuperAdmin(session);
  await requireTenantUserPermission(session, "USERS_VIEW");
  const parsed = managedTenantUsersInputSchema.safeParse(input);
  if (!parsed.success) {
    throw validationError(parsed.error.issues[0]?.message ?? "Invalid input");
  }
  const tenant = await prisma.tenant.findFirst({
    where: { uuid: parsed.data.tenantId, type: TenantType.SUB, deletedAt: null },
    select: { uuid: true },
  });
  if (!tenant) throw validationError("Sub-tenant not found");

  const page = parsed.data.page ?? 1;
  const pageSize = parsed.data.pageSize ?? 10;
  const search = parsed.data.search;
  const where: Prisma.TenantMembershipWhereInput = {
    tenantUuid: tenant.uuid,
    status: { in: [MembershipStatus.ACTIVE, MembershipStatus.DISABLED] },
    role: { code: { in: ["ADMIN", "EDITOR"] } },
    user: {
      deletedAt: null,
      ...(search
        ? {
            OR: [
              { firstName: { contains: search, mode: "insensitive" } },
              { lastName: { contains: search, mode: "insensitive" } },
              { email: { contains: search, mode: "insensitive" } },
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
        role: { select: { code: true } },
        user: {
          select: {
            uuid: true,
            email: true,
            firstName: true,
            lastName: true,
            username: true,
            status: true,
            activatedAt: true,
            activationTokens: {
              orderBy: { createdAt: "desc" },
              take: 1,
              select: {
                createdAt: true,
                expiresAt: true,
                usedAt: true,
                revokedAt: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.tenantMembership.count({ where }),
  ]);
  const now = new Date();
  return {
    items: rows.map(({ user, role, status }) => ({
      id: user.uuid,
      fullName: displayFullName(user),
      firstName: user.firstName,
      lastName: user.lastName,
      username: user.username,
      email: user.email,
      role: role.code,
      accountStatus: user.status,
      membershipStatus: status,
      activationStatus: deriveActivationStatus(user, now),
      activationLinkCreatedAt: user.activationTokens[0]?.createdAt.toISOString() ?? null,
      activationLinkExpiresAt: user.activationTokens[0]?.expiresAt.toISOString() ?? null,
    })),
    total,
    page,
    pageSize,
  };
}


export async function listTenantUsers(
  session: SessionPayload,
  input?: { search?: string; page?: number; pageSize?: number },
) {
  await requireTenantUserPermission(session, "USERS_VIEW");

  const page = Math.max(1, input?.page ?? 1);
  const pageSize = Math.min(50, Math.max(1, input?.pageSize ?? 10));
  const search = input?.search?.trim();

  const where: Prisma.TenantMembershipWhereInput = {
    tenantUuid: session.tenantId,
    status: { in: [MembershipStatus.ACTIVE, MembershipStatus.DISABLED] },
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
      membershipStatus: row.status,
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
