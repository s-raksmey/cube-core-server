import { ArticleStatus, Prisma, TenantStatus, TenantType } from "@prisma/client";
import type { SessionPayload } from "@/src/lib/auth/session";
import { prisma } from "@/src/lib/db";
import { forbidden } from "@/src/lib/errors";
import { getTenantUserPermissions } from "@/src/modules/roles/role-permission.service";
import { fillPoints, metric, parseAnalyticsRange, type AnalyticsRange } from "./analytics-range";

type Point = { date: string; value: number };
type Performance = { id: string; name: string; views: number; shares: number };

function ownerFilter(ownerId?: string) {
  return ownerId ? Prisma.sql`AND a."created_by_uuid" = ${ownerId}` : Prisma.empty;
}

async function series(table: "article_views" | "article_shares", column: "viewed_at" | "shared_at", tenantId: string, range: AnalyticsRange, ownerId?: string) {
  // Table and column are fixed server-side identifiers; values are parameterized.
  const rows = await prisma.$queryRaw<Point[]>(Prisma.sql`
    SELECT to_char(date_trunc(${range.grouping}, e.${Prisma.raw(`"${column}"`)}), 'YYYY-MM-DD') AS date,
           count(*)::int AS value
    FROM ${Prisma.raw(`"${table}"`)} e
    JOIN "articles" a ON a."uuid" = e."article_uuid" AND a."tenant_uuid" = e."tenant_uuid"
    WHERE e."tenant_uuid" = ${tenantId} AND e.${Prisma.raw(`"${column}"`)} >= ${range.start}
      AND e.${Prisma.raw(`"${column}"`)} < ${range.end} ${ownerFilter(ownerId)}
    GROUP BY 1 ORDER BY 1`);
  return fillPoints(range, rows);
}

async function publishingSeries(tenantId: string, range: AnalyticsRange, ownerId?: string) {
  const rows = await prisma.$queryRaw<Point[]>(Prisma.sql`
    SELECT to_char(date_trunc(${range.grouping}, a."published_at"), 'YYYY-MM-DD') AS date,
           count(*)::int AS value
    FROM "articles" a
    WHERE a."tenant_uuid" = ${tenantId}
      AND a."published_at" >= ${range.start} AND a."published_at" < ${range.end}
      ${ownerFilter(ownerId)}
    GROUP BY 1 ORDER BY 1`);
  return fillPoints(range, rows);
}

async function topArticles(tenantId: string, range: AnalyticsRange, ownerId?: string) {
  const scope = { tenantUuid: tenantId, ...(ownerId ? { article: { createdByUuid: ownerId } } : {}) };
  const [viewLeaders, shareLeaders] = await Promise.all([
    prisma.articleView.groupBy({ by: ["articleUuid"], where: { ...scope, viewedAt: { gte: range.start, lt: range.end } },
      _count: { _all: true }, orderBy: { _count: { articleUuid: "desc" } }, take: 5 }),
    prisma.articleShare.groupBy({ by: ["articleUuid"], where: { ...scope, sharedAt: { gte: range.start, lt: range.end } },
      _count: { _all: true }, orderBy: { _count: { articleUuid: "desc" } }, take: 5 }),
  ]);
  const ids = [...new Set([...viewLeaders, ...shareLeaders].map((row) => row.articleUuid))];
  if (!ids.length) return { mostViewed: [], mostShared: [] };
  const [articles, views, shares] = await Promise.all([
    prisma.article.findMany({ where: { uuid: { in: ids }, tenantUuid: tenantId, ...(ownerId ? { createdByUuid: ownerId } : {}) },
      select: { uuid: true, title: true } }),
    prisma.articleView.groupBy({ by: ["articleUuid"], where: { ...scope, articleUuid: { in: ids }, viewedAt: { gte: range.start, lt: range.end } }, _count: { _all: true } }),
    prisma.articleShare.groupBy({ by: ["articleUuid"], where: { ...scope, articleUuid: { in: ids }, sharedAt: { gte: range.start, lt: range.end } }, _count: { _all: true } }),
  ]);
  const byId = new Map(articles.map((article) => [article.uuid, article]));
  const viewCounts = new Map(views.map((row) => [row.articleUuid, row._count._all]));
  const shareCounts = new Map(shares.map((row) => [row.articleUuid, row._count._all]));
  const map = (id: string) => {
    const article = byId.get(id);
    return article ? { id, name: article.title,
      views: viewCounts.get(id) ?? 0, shares: shareCounts.get(id) ?? 0 } : null;
  };
  return {
    mostViewed: viewLeaders.map((row) => map(row.articleUuid)).filter((row) => row !== null),
    mostShared: shareLeaders.map((row) => map(row.articleUuid)).filter((row) => row !== null),
  };
}

async function topDimension(dimension: "category" | "subcategory" | "tag", tenantId: string, range: AnalyticsRange) {
  // An article contributes its engagement to every attached tag; category and subcategory are singular.
  const join = dimension === "category"
    ? Prisma.sql`JOIN "categories" d ON d."uuid" = a."category_uuid" AND d."tenant_uuid" = a."tenant_uuid"`
    : dimension === "subcategory"
      ? Prisma.sql`JOIN "subcategories" d ON d."uuid" = a."subcategory_uuid" AND d."tenant_uuid" = a."tenant_uuid"`
      : Prisma.sql`JOIN "article_tags" at ON at."article_uuid" = a."uuid" AND at."tenant_uuid" = a."tenant_uuid"
                   JOIN "tags" d ON d."uuid" = at."tag_uuid" AND d."tenant_uuid" = a."tenant_uuid"`;
  const name = dimension === "subcategory" ? Prisma.sql`d."slug"` : Prisma.sql`d."name"`;
  return prisma.$queryRaw<Performance[]>(Prisma.sql`
    WITH engagement AS (
      SELECT "article_uuid", count(*)::int AS views, 0::int AS shares
      FROM "article_views" WHERE "tenant_uuid" = ${tenantId} AND "viewed_at" >= ${range.start} AND "viewed_at" < ${range.end}
      GROUP BY "article_uuid"
      UNION ALL
      SELECT "article_uuid", 0::int AS views, count(*)::int AS shares
      FROM "article_shares" WHERE "tenant_uuid" = ${tenantId} AND "shared_at" >= ${range.start} AND "shared_at" < ${range.end}
      GROUP BY "article_uuid"
    )
    SELECT d."uuid" AS id, ${name} AS name, sum(e.views)::int AS views, sum(e.shares)::int AS shares
    FROM engagement e JOIN "articles" a ON a."uuid" = e."article_uuid" AND a."tenant_uuid" = ${tenantId}
    ${join}
    GROUP BY d."uuid", ${name} ORDER BY views DESC, shares DESC, name ASC LIMIT 5`);
}

async function presentation(tenantId: string, range: AnalyticsRange, flag: "isBreaking" | "isFeatured") {
  const article = { [flag]: true };
  const [published, views, shares] = await Promise.all([
    prisma.article.count({ where: { tenantUuid: tenantId, status: ArticleStatus.PUBLISHED, ...article } }),
    prisma.articleView.count({ where: { tenantUuid: tenantId, viewedAt: { gte: range.start, lt: range.end }, article } }),
    prisma.articleShare.count({ where: { tenantUuid: tenantId, sharedAt: { gte: range.start, lt: range.end }, article } }),
  ]);
  return { published, views, shares };
}

export async function getPlatformAnalytics(session: SessionPayload, input: unknown) {
  if (session.audience !== "ADMIN_CONSOLE" || session.role !== "SUPERADMIN") throw forbidden("Platform analytics require Main access");
  await getTenantUserPermissions(session);
  const range = parseAnalyticsRange(input);
  const tenantScope = { type: TenantType.SUB, deletedAt: null };
  const [totalTenants, activeTenants, suspendedTenants, tenantUsers, growthRows, actions] = await Promise.all([
    prisma.tenant.count({ where: tenantScope }),
    prisma.tenant.count({ where: { ...tenantScope, status: TenantStatus.ACTIVE } }),
    prisma.tenant.count({ where: { ...tenantScope, status: TenantStatus.SUSPENDED } }),
    prisma.user.count({ where: { deletedAt: null, memberships: { some: { tenant: tenantScope } } } }),
    prisma.$queryRaw<Point[]>(Prisma.sql`
      SELECT to_char(date_trunc(${range.grouping}, "created_at"), 'YYYY-MM-DD') AS date, count(*)::int AS value
      FROM "tenants" WHERE "type" = 'SUB'::"TenantType" AND "deleted_at" IS NULL
        AND "created_at" >= ${range.start} AND "created_at" < ${range.end}
      GROUP BY 1 ORDER BY 1`),
    prisma.auditLog.groupBy({ by: ["tenantUuid"], where: { tenantUuid: { not: null }, createdAt: { gte: range.start, lt: range.end },
      tenant: tenantScope }, _count: { _all: true }, orderBy: { _count: { tenantUuid: "desc" } }, take: 8 }),
  ]);
  const tenants = await prisma.tenant.findMany({ where: { uuid: { in: actions.map((row) => row.tenantUuid!).filter(Boolean) }, ...tenantScope }, select: { uuid: true, name: true } });
  const names = new Map(tenants.map((row) => [row.uuid, row.name]));
  return { start: range.start.toISOString(), end: range.end.toISOString(), grouping: range.grouping,
    totalTenants, activeTenants, suspendedTenants, tenantUsers, growth: fillPoints(range, growthRows),
    // Activity means recorded audit actions in this period, not an estimate of visits.
    tenantActivity: actions.flatMap((row) => row.tenantUuid && names.has(row.tenantUuid)
      ? [{ name: names.get(row.tenantUuid)!, count: row._count._all }] : []),
  };
}

export async function getTenantAnalytics(session: SessionPayload, input: unknown) {
  if (session.audience !== "TENANT_APP") throw forbidden("Tenant analytics require a tenant session");
  const permissions = await getTenantUserPermissions(session);
  const tenantWide = permissions.includes("ANALYTICS_VIEW_TENANT");
  if (!tenantWide && !permissions.includes("ANALYTICS_VIEW_OWN")) throw forbidden("Analytics permission required");
  const range = parseAnalyticsRange(input);
  const tenantId = session.tenantId;
  const ownerId = tenantWide ? undefined : session.userId;
  const articleScope = { tenantUuid: tenantId, ...(ownerId ? { createdByUuid: ownerId } : {}) };
  const viewScope = { tenantUuid: tenantId, ...(ownerId ? { article: { createdByUuid: ownerId } } : {}) };
  const current = { gte: range.start, lt: range.end };
  const previous = { gte: range.previousStart, lt: range.start };
  const [statusRows, currentViews, previousViews, currentShares, previousShares,
    currentPublished, previousPublished, viewsOverTime, sharesOverTime, publishingOverTime,
    leaders, recentArticles] = await Promise.all([
    prisma.article.groupBy({ by: ["status"], where: articleScope, _count: { _all: true } }),
    prisma.articleView.count({ where: { ...viewScope, viewedAt: current } }),
    prisma.articleView.count({ where: { ...viewScope, viewedAt: previous } }),
    prisma.articleShare.count({ where: { ...viewScope, sharedAt: current } }),
    prisma.articleShare.count({ where: { ...viewScope, sharedAt: previous } }),
    prisma.article.count({ where: { ...articleScope, publishedAt: current } }),
    prisma.article.count({ where: { ...articleScope, publishedAt: previous } }),
    series("article_views", "viewed_at", tenantId, range, ownerId),
    series("article_shares", "shared_at", tenantId, range, ownerId),
    publishingSeries(tenantId, range, ownerId),
    topArticles(tenantId, range, ownerId),
    ownerId ? prisma.article.findMany({ where: articleScope, orderBy: { updatedAt: "desc" }, take: 6,
      select: { uuid: true, title: true, status: true } }) : Promise.resolve([]),
  ]);
  const status = Object.fromEntries(statusRows.map((row) => [row.status, row._count._all]));
  const base = { scope: tenantWide ? "TENANT" : "OWN", start: range.start.toISOString(), end: range.end.toISOString(),
    grouping: range.grouping, totalArticles: statusRows.reduce((sum, row) => sum + row._count._all, 0),
    statusCounts: ["DRAFT", "IN_REVIEW", "SCHEDULED", "PUBLISHED", "ARCHIVED"].map((name) => ({ name, count: status[name] ?? 0 })),
    views: metric(currentViews, previousViews), shares: metric(currentShares, previousShares),
    published: metric(currentPublished, previousPublished), viewsOverTime, sharesOverTime, publishingOverTime,
    mostViewed: leaders.mostViewed, mostShared: leaders.mostShared,
    recentArticles: recentArticles.map((row) => ({ id: row.uuid, name: row.title, status: row.status })),
  };
  if (!tenantWide) return { ...base, categories: [], subcategories: [], tags: [], breaking: null, featured: null,
    sharePlatforms: [], reviews: null, authorActivity: [] };

  const [categories, subcategories, tags, breaking, featured, platformRows, reviewRows, reviewTimeRows, authorActivity] = await Promise.all([
    topDimension("category", tenantId, range), topDimension("subcategory", tenantId, range), topDimension("tag", tenantId, range),
    presentation(tenantId, range, "isBreaking"), presentation(tenantId, range, "isFeatured"),
    prisma.articleShare.groupBy({ by: ["platform"], where: { tenantUuid: tenantId, sharedAt: current }, _count: { _all: true } }),
    prisma.articleReview.groupBy({ by: ["decision"], where: { tenantUuid: tenantId, createdAt: current }, _count: { _all: true } }),
    prisma.$queryRaw<{ hours: number | null }[]>(Prisma.sql`
      WITH cycles AS (
        SELECT "decision", "created_at", lag("decision") OVER (PARTITION BY "article_uuid" ORDER BY "created_at", "uuid") AS previous_decision,
          lag("created_at") OVER (PARTITION BY "article_uuid" ORDER BY "created_at", "uuid") AS submitted_at
        FROM "article_reviews" WHERE "tenant_uuid" = ${tenantId} AND "created_at" < ${range.end}
      )
      SELECT (avg(extract(epoch FROM ("created_at" - submitted_at))) / 3600)::float AS hours
      FROM cycles WHERE previous_decision = 'SUBMITTED'::"ArticleReviewDecision"
        AND "decision" IN ('CHANGES_REQUESTED'::"ArticleReviewDecision", 'APPROVED'::"ArticleReviewDecision")
        AND "created_at" >= ${range.start}`),
    prisma.$queryRaw<{ id: string; name: string; created: number; submitted: number; published: number }[]>(Prisma.sql`
      WITH submissions AS (
        SELECT "article_uuid", count(*)::int AS submitted FROM "article_reviews"
        WHERE "tenant_uuid" = ${tenantId} AND "decision" = 'SUBMITTED'::"ArticleReviewDecision"
          AND "created_at" >= ${range.start} AND "created_at" < ${range.end}
        GROUP BY "article_uuid"
      )
      SELECT u."uuid" AS id, trim(u."first_name" || ' ' || u."last_name") AS name,
        count(*) FILTER (WHERE a."created_at" >= ${range.start} AND a."created_at" < ${range.end})::int AS created,
        coalesce(sum(s.submitted), 0)::int AS submitted,
        count(*) FILTER (WHERE a."published_at" >= ${range.start} AND a."published_at" < ${range.end})::int AS published
      FROM "articles" a JOIN "users" u ON u."uuid" = a."created_by_uuid"
      LEFT JOIN submissions s ON s."article_uuid" = a."uuid"
      WHERE a."tenant_uuid" = ${tenantId} AND (a."created_at" >= ${range.start} AND a."created_at" < ${range.end}
        OR a."published_at" >= ${range.start} AND a."published_at" < ${range.end} OR s.submitted IS NOT NULL)
      GROUP BY u."uuid", u."first_name", u."last_name" ORDER BY created DESC, submitted DESC, published DESC LIMIT 10`),
  ]);
  const decisions = Object.fromEntries(reviewRows.map((row) => [row.decision, row._count._all]));
  return { ...base, categories, subcategories, tags, breaking, featured,
    sharePlatforms: platformRows.map((row) => ({ name: row.platform, count: row._count._all })),
    reviews: { submitted: decisions.SUBMITTED ?? 0, changesRequested: decisions.CHANGES_REQUESTED ?? 0,
      approved: decisions.APPROVED ?? 0, averageReviewHours: reviewTimeRows[0]?.hours ?? null,
      waiting: status.IN_REVIEW ?? 0 }, authorActivity };
}
