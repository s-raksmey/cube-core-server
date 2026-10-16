import {
  ArticleStatus,
  MembershipStatus,
  Prisma,
  TenantStatus,
  TenantType,
  UserStatus,
} from "@prisma/client";
import { prisma } from "@/src/lib/db";
import type { SessionPayload } from "@/src/lib/auth/session";
import { forbidden } from "@/src/lib/errors";
import { getTenantUserPermissions } from "@/src/modules/roles/role-permission.service";

const AUDIT_LOG_PAGE_SIZE = 10;

const auditLogSelect = {
  uuid: true,
  action: true,
  createdAt: true,
  targetType: true,
  targetUuid: true,
  metadata: true,
  actorUser: { select: { email: true } },
  tenant: { select: { name: true } },
} satisfies Prisma.AuditLogSelect;

function auditLogPageNumber(value?: number | null) {
  return Math.max(1, Math.floor(value ?? 1));
}

function auditLogSucceeded(action: string) {
  return !/\.(failed|rejected(?:_[a-z]+)?|locked|denied|error)$/i.test(action);
}

function auditLogDetails(metadata: Prisma.JsonValue) {
  if (!metadata || (typeof metadata === "object" && !Array.isArray(metadata) && Object.keys(metadata).length === 0)) {
    return null;
  }

  const serialized = JSON.stringify(metadata);
  return serialized.length > 1_000 ? `${serialized.slice(0, 997)}…` : serialized;
}

function mapAuditLog(
  log: Prisma.AuditLogGetPayload<{ select: typeof auditLogSelect }>,
) {
  return {
    id: log.uuid,
    action: log.action,
    success: auditLogSucceeded(log.action),
    createdAt: log.createdAt.toISOString(),
    actorEmail: log.actorUser?.email ?? null,
    targetTenantName: log.tenant?.name ?? null,
    targetType: log.targetType,
    targetId: log.targetUuid,
    details: auditLogDetails(log.metadata),
  };
}

export async function getPlatformAuditLogs(
  session: SessionPayload,
  requestedPage?: number | null,
) {
  if (session.role !== "SUPERADMIN") {
    throw forbidden("Platform audit logs require SuperAdmin");
  }

  const page = auditLogPageNumber(requestedPage);
  const [total, logs] = await Promise.all([
    prisma.auditLog.count(),
    prisma.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * AUDIT_LOG_PAGE_SIZE,
      take: AUDIT_LOG_PAGE_SIZE,
      select: auditLogSelect,
    }),
  ]);

  return {
    items: logs.map(mapAuditLog),
    total,
    page,
    pageSize: AUDIT_LOG_PAGE_SIZE,
  };
}

export async function getTenantAuditLogs(
  session: SessionPayload,
  requestedPage?: number | null,
) {
  if (session.role !== "ADMIN" && session.role !== "EDITOR") {
    throw forbidden("Tenant audit logs require Admin or Editor");
  }

  const page = auditLogPageNumber(requestedPage);
  const where = {
    tenantUuid: session.tenantId,
    // A tenant workspace may not inspect actions performed by a platform user
    // or another tenant. Keep only events whose actor has membership here.
    actorUser: {
      memberships: { some: { tenantUuid: session.tenantId } },
    },
  };
  const [total, logs] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * AUDIT_LOG_PAGE_SIZE,
      take: AUDIT_LOG_PAGE_SIZE,
      select: auditLogSelect,
    }),
  ]);

  return {
    items: logs.map(mapAuditLog),
    total,
    page,
    pageSize: AUDIT_LOG_PAGE_SIZE,
  };
}

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
    session.role !== "EDITOR"
  ) {
    throw forbidden("Tenant dashboard requires Admin or Editor");
  }

  const tenant = await prisma.tenant.findUnique({
    where: { uuid: session.tenantId },
    select: { uuid: true, name: true, slug: true, type: true, status: true, createdAt: true },
  });

  if (!tenant || tenant.type !== TenantType.SUB) {
    throw forbidden("Invalid sub-tenant session");
  }

  const permissions = await getTenantUserPermissions(session);
  const canViewUsers = permissions.includes("USERS_VIEW");
  const canViewTenantAnalytics = permissions.includes("ANALYTICS_VIEW_TENANT");
  const canViewOwnAnalytics = permissions.includes("ANALYTICS_VIEW_OWN");
  const articleScope = canViewTenantAnalytics || canViewOwnAnalytics
    ? { tenantUuid: session.tenantId, ...(!canViewTenantAnalytics ? { createdByUuid: session.userId } : {}) }
    : null;
  const activitySince = startOfMonthsAgo(6);
  const activityUntil = new Date();
  const ownerFilter = canViewTenantAnalytics ? Prisma.empty : Prisma.sql`AND a."created_by_uuid" = ${session.userId}`;

  const [totalUsers, activeUsers, statusRows, publishingRows, engagementRows] =
    await Promise.all([
      canViewUsers ? prisma.tenantMembership.count({
        where: {
          tenantUuid: session.tenantId,
          user: { deletedAt: null },
        },
      }) : Promise.resolve(0),
      canViewUsers ? prisma.tenantMembership.count({
        where: {
          tenantUuid: session.tenantId,
          user: { deletedAt: null, status: UserStatus.ACTIVE },
        },
      }) : Promise.resolve(0),
      articleScope ? prisma.article.groupBy({
        by: ["status"], where: articleScope, _count: { _all: true },
      }) : Promise.resolve([]),
      articleScope ? prisma.$queryRaw<{ month: string; count: number }[]>(Prisma.sql`
        SELECT to_char(date_trunc('month', a."published_at"), 'YYYY-MM') AS month,
               count(*)::int AS count
        FROM "articles" a
        WHERE a."tenant_uuid" = ${session.tenantId}
          AND a."published_at" >= ${activitySince} AND a."published_at" < ${activityUntil}
          ${ownerFilter}
        GROUP BY 1 ORDER BY 1
      `) : Promise.resolve([]),
      articleScope ? prisma.$queryRaw<{ source: string; month: string; count: number }[]>(Prisma.sql`
        SELECT 'VIEWS' AS source, to_char(date_trunc('month', v."viewed_at"), 'YYYY-MM') AS month,
               count(*)::int AS count
        FROM "article_views" v
        JOIN "articles" a ON a."uuid" = v."article_uuid" AND a."tenant_uuid" = v."tenant_uuid"
        WHERE v."tenant_uuid" = ${session.tenantId}
          AND v."viewed_at" >= ${activitySince} AND v."viewed_at" < ${activityUntil}
          ${ownerFilter}
        GROUP BY 2
        UNION ALL
        SELECT 'SHARES' AS source, to_char(date_trunc('month', s."shared_at"), 'YYYY-MM') AS month,
               count(*)::int AS count
        FROM "article_shares" s
        JOIN "articles" a ON a."uuid" = s."article_uuid" AND a."tenant_uuid" = s."tenant_uuid"
        WHERE s."tenant_uuid" = ${session.tenantId}
          AND s."shared_at" >= ${activitySince} AND s."shared_at" < ${activityUntil}
          ${ownerFilter}
        GROUP BY 2
      `) : Promise.resolve([]),
    ]);

  const publishedByMonth = new Map(publishingRows.map((row) => [row.month, row.count]));
  const countByStatus = new Map(statusRows.map((row) => [row.status, row._count._all]));
  const viewsByMonth = new Map(engagementRows.filter((row) => row.source === "VIEWS").map((row) => [row.month, row.count]));
  const sharesByMonth = new Map(engagementRows.filter((row) => row.source === "SHARES").map((row) => [row.month, row.count]));
  const months = Array.from({ length: 6 }, (_, i) => {
    const date = new Date(activitySince);
    date.setUTCMonth(date.getUTCMonth() + i);
    return monthKey(date);
  });
  const monthCounts = (counts: Map<string, number>) => months.map((month) => ({ month, count: counts.get(month) ?? 0 }));

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
    publishedContent: countByStatus.get(ArticleStatus.PUBLISHED) ?? 0,
    contentActivityByMonth: monthCounts(publishedByMonth),
    contentByStatus: articleScope
      ? Object.values(ArticleStatus).map((status) => ({ status, count: countByStatus.get(status) ?? 0 }))
      : [],
    viewsByMonth: monthCounts(viewsByMonth),
    sharesByMonth: monthCounts(sharesByMonth),
  };
}
