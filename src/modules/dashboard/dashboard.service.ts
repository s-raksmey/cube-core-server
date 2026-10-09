import {
  TenantStatus,
  TenantType,
  UserRole,
  UserStatus,
} from "@prisma/client";
import { prisma } from "@/src/lib/db";
import type { SessionPayload } from "@/src/lib/auth/session";
import { forbidden } from "@/src/lib/errors";

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
  if (session.role !== UserRole.SUPERADMIN) {
    throw forbidden("Platform dashboard requires SuperAdmin");
  }

  const [totalSubTenants, activeSubTenants, totalAdmins, recentTenants, auditLogs, allSubTenants] =
    await Promise.all([
      prisma.tenant.count({ where: { type: TenantType.SUB } }),
      prisma.tenant.count({
        where: { type: TenantType.SUB, status: TenantStatus.ACTIVE },
      }),
      prisma.user.count({ where: { role: UserRole.ADMIN } }),
      prisma.tenant.findMany({
        where: { type: TenantType.SUB },
        orderBy: { createdAt: "desc" },
        take: 8,
        select: {
          id: true,
          name: true,
          slug: true,
          status: true,
          createdAt: true,
        },
      }),
      prisma.auditLog.findMany({
        orderBy: { createdAt: "desc" },
        take: 8,
        select: {
          id: true,
          action: true,
          createdAt: true,
          metadata: true,
          actorUser: { select: { email: true } },
          targetTenant: { select: { name: true, slug: true } },
        },
      }),
      prisma.tenant.findMany({
        where: {
          type: TenantType.SUB,
          createdAt: { gte: startOfMonthsAgo(6) },
        },
        select: { createdAt: true, status: true },
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

  const suspendedSubTenants = await prisma.tenant.count({
    where: { type: TenantType.SUB, status: TenantStatus.SUSPENDED },
  });

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
    recentSubTenants: recentTenants,
    recentActivity: auditLogs.map((log) => ({
      id: log.id,
      action: log.action,
      createdAt: log.createdAt,
      actorEmail: log.actorUser?.email ?? null,
      targetTenantName: log.targetTenant?.name ?? null,
      targetTenantSlug: log.targetTenant?.slug ?? null,
    })),
  };
}

export async function getTenantDashboard(session: SessionPayload) {
  if (session.role !== UserRole.ADMIN && session.role !== UserRole.EDITOR) {
    throw forbidden("Tenant dashboard requires Admin or Editor");
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: session.tenantId },
  });

  if (!tenant || tenant.type !== TenantType.SUB) {
    throw forbidden("Invalid sub-tenant session");
  }

  const [totalUsers, activeUsers, recentUsers, auditLogs] = await Promise.all([
    prisma.user.count({ where: { tenantId: session.tenantId } }),
    prisma.user.count({
      where: { tenantId: session.tenantId, status: UserStatus.ACTIVE },
    }),
    prisma.user.findMany({
      where: { tenantId: session.tenantId },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        createdAt: true,
      },
    }),
    prisma.auditLog.findMany({
      where: { targetTenantId: session.tenantId },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: {
        id: true,
        action: true,
        createdAt: true,
        actorUser: { select: { email: true } },
      },
    }),
  ]);

  // Content/media modules are not implemented yet — return explicit zeros.
  return {
    tenant: {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      status: tenant.status,
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
    recentUsers,
    recentActivity: auditLogs.map((log) => ({
      id: log.id,
      action: log.action,
      createdAt: log.createdAt,
      actorEmail: log.actorUser?.email ?? null,
    })),
  };
}
