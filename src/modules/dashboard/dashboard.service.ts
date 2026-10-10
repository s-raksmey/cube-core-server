import {
  MembershipStatus,
  TenantStatus,
  TenantType,
  UserStatus,
} from "@prisma/client";
import { prisma } from "@/src/lib/db";
import type { SessionPayload } from "@/src/lib/auth/session";
import { forbidden } from "@/src/lib/errors";
import { displayFullName } from "@/src/modules/users/account";

function startOfMonthsAgo(months: number) {
  const date = new Date();
  date.setUTCDate(1);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCMonth(date.getUTCMonth() - (months - 1));
  return date;
}

function monthKey(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export async function getPlatformDashboard(session: SessionPayload) {
  if (session.role !== "SUPERADMIN") {
    throw forbidden("Platform dashboard requires SuperAdmin");
  }

  const [
    totalSubTenants,
    activeSubTenants,
    totalAdmins,
    recentTenants,
    auditLogs,
    allSubTenants,
    suspendedSubTenants,
  ] = await Promise.all([
    prisma.tenant.count({
      where: { type: TenantType.SUB, deletedAt: null },
    }),
    prisma.tenant.count({
      where: {
        type: TenantType.SUB,
        status: TenantStatus.ACTIVE,
        deletedAt: null,
      },
    }),
    prisma.tenantMembership.count({
      where: {
        status: MembershipStatus.ACTIVE,
        role: { code: "ADMIN" },
        tenant: { type: TenantType.SUB, deletedAt: null },
        user: { deletedAt: null },
      },
    }),
    prisma.tenant.findMany({
      where: { type: TenantType.SUB, deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: {
        uuid: true,
        name: true,
        slug: true,
        type: true,
        status: true,
        createdAt: true,
      },
    }),
    prisma.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 8,
      select: {
        uuid: true,
        action: true,
        createdAt: true,
        metadata: true,
        actorUser: { select: { email: true } },
        tenant: { select: { name: true, slug: true } },
      },
    }),
    prisma.tenant.findMany({
      where: {
        type: TenantType.SUB,
        deletedAt: null,
        createdAt: { gte: startOfMonthsAgo(6) },
      },
      select: { createdAt: true, status: true },
    }),
    prisma.tenant.count({
      where: {
        type: TenantType.SUB,
        status: TenantStatus.SUSPENDED,
        deletedAt: null,
      },
    }),
  ]);

  const growthMap = new Map<string, number>();
  for (let i = 0; i < 6; i += 1) {
    const d = startOfMonthsAgo(6);
    d.setUTCMonth(d.getUTCMonth() + i);
    growthMap.set(monthKey(d), 0);
  }
  for (const tenant of allSubTenants) {
    const key = monthKey(tenant.createdAt);
    if (growthMap.has(key)) {
      growthMap.set(key, (growthMap.get(key) ?? 0) + 1);
    }
  }

  return {
    totalSubTenants,
    activeSubTenants,
    totalAdmins,
    platformHealth: "operational",
    growthByMonth: Array.from(growthMap.entries()).map(([month, count]) => ({
      month,
      count,
    })),
    statusDistribution: [
      { status: "ACTIVE", count: activeSubTenants },
      { status: "SUSPENDED", count: suspendedSubTenants },
    ],
    recentSubTenants: recentTenants.map((t) => ({
      id: t.uuid,
      uuid: t.uuid,
      name: t.name,
      slug: t.slug,
      type: t.type,
      status: t.status,
      createdAt: t.createdAt.toISOString(),
    })),
    recentActivity: auditLogs.map((log) => ({
      id: log.uuid,
      action: log.action,
      createdAt: log.createdAt,
      actorEmail: log.actorUser?.email ?? null,
      targetTenantName: log.tenant?.name ?? null,
      targetTenantSlug: log.tenant?.slug ?? null,
    })),
  };
}

export async function getTenantDashboard(session: SessionPayload) {
  if (
    session.role !== "ADMIN" &&
    session.role !== "EDITOR" &&
    session.role !== "AUTHOR"
  ) {
    throw forbidden("Tenant dashboard requires Admin, Editor, or Author");
  }

  const tenant = await prisma.tenant.findUnique({
    where: { uuid: session.tenantId },
  });

  if (!tenant || tenant.type !== TenantType.SUB) {
    throw forbidden("Invalid sub-tenant session");
  }

  const [totalUsers, activeUsers, recentMemberships, auditLogs] =
    await Promise.all([
      prisma.tenantMembership.count({
        where: {
          tenantUuid: session.tenantId,
          user: { deletedAt: null },
        },
      }),
      prisma.tenantMembership.count({
        where: {
          tenantUuid: session.tenantId,
          user: { deletedAt: null, status: UserStatus.ACTIVE },
        },
      }),
      prisma.tenantMembership.findMany({
        where: {
          tenantUuid: session.tenantId,
          user: { deletedAt: null },
        },
        orderBy: { createdAt: "desc" },
        take: 8,
        include: { user: true, role: true },
      }),
      prisma.auditLog.findMany({
        where: { tenantUuid: session.tenantId },
        orderBy: { createdAt: "desc" },
        take: 8,
        select: {
          uuid: true,
          action: true,
          createdAt: true,
          actorUser: { select: { email: true } },
        },
      }),
    ]);

  return {
    tenant: {
      id: tenant.uuid,
      uuid: tenant.uuid,
      name: tenant.name,
      slug: tenant.slug,
      type: tenant.type,
      status: tenant.status,
      createdAt: tenant.createdAt.toISOString(),
    },
    totalUsers,
    activeUsers,
    publishedContent: 0,
    mediaStorageBytes: 0,
    contentActivityByMonth: Array.from({ length: 6 }, (_, i) => {
      const d = startOfMonthsAgo(6);
      d.setUTCMonth(d.getUTCMonth() + i);
      return { month: monthKey(d), count: 0 };
    }),
    contentByStatus: [
      { status: "DRAFT", count: 0 },
      { status: "PUBLISHED", count: 0 },
    ],
    recentUsers: recentMemberships.map((row) => ({
      id: row.user.uuid,
      email: row.user.email,
      username: row.user.username,
      firstName: row.user.firstName,
      lastName: row.user.lastName,
      fullName: displayFullName(row.user),
      type: "SUB",
      role: row.role.code,
      status: row.user.status,
      tenantId: session.tenantId,
      createdAt: row.user.createdAt,
    })),
    recentActivity: auditLogs.map((log) => ({
      id: log.uuid,
      action: log.action,
      createdAt: log.createdAt,
      actorEmail: log.actorUser?.email ?? null,
    })),
  };
}
