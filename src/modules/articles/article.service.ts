import { ArticleStatus, Prisma, TenantType } from "@prisma/client";
import { z } from "zod";
import type { SessionPayload } from "@/src/lib/auth/session";
import { prisma } from "@/src/lib/db";
import { forbidden, notFound, validationError } from "@/src/lib/errors";
import { writeAuthAudit } from "@/src/modules/auth/audit-auth";
import { getTenantUserPermissions, type TenantUserPermission } from "@/src/modules/roles/role-permission.service";
import { assertArticleTransition, canEditArticleStatus, type ArticleAction } from "./article-policy";
import { articleAuthorRoles, assertCanManageArticleAuthor } from "./article-role-access";
import { commentSchema, createArticleSchema, scheduleAtSchema, updateArticleSchema } from "./article-validation";

type PermissionSet = Set<TenantUserPermission>;

async function access(session: SessionPayload) {
  if (session.audience !== "TENANT_APP") throw forbidden("Sub-tenant access is required");
  const permissions = new Set(await getTenantUserPermissions(session));
  return { tenantUuid: session.tenantId, permissions };
}
function requirePermission(permissions: PermissionSet, permission: TenantUserPermission) {
  if (!permissions.has(permission)) throw forbidden("You do not have permission to perform this action");
}
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw validationError(result.error.issues[0]?.message ?? "Invalid article input");
  return result.data;
}
function mapMutationError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") throw validationError("An article with this slug already exists in this tenant");
    if (error.code === "P2003") throw validationError("Invalid article category, subcategory or tag");
    if (error.code === "P2025") throw validationError("Article changed while this action was in progress. Refresh and try again");
  }
  throw error;
}
const listSelect = {
  uuid: true, title: true, slug: true, status: true, categoryUuid: true, createdByUuid: true,
  isBreaking: true, isFeatured: true, featuredImageUrl: true, scheduledAt: true, updatedAt: true,
  category: { select: { name: true } },
  createdBy: { select: { firstName: true, lastName: true } },
} satisfies Prisma.ArticleSelect;
const detailSelect = {
  ...listSelect,
  summary: true, content: true, subcategoryUuid: true, publishedAt: true, archivedAt: true,
  createdAt: true, publishedByUuid: true,
  subcategory: { select: { translations: { where: { locale: "en" }, select: { name: true } } } },
  tags: { select: { tag: { select: { uuid: true, name: true } } }, orderBy: { tagUuid: "asc" } },
  translations: { select: { locale: true, title: true, summary: true, content: true }, orderBy: { locale: "asc" } },
  reviews: { select: { uuid: true, decision: true, comment: true, createdAt: true, reviewer: { select: { firstName: true, lastName: true } } }, orderBy: { createdAt: "asc" } },
} satisfies Prisma.ArticleSelect;
type ListRow = Prisma.ArticleGetPayload<{ select: typeof listSelect }>;
type DetailRow = Prisma.ArticleGetPayload<{ select: typeof detailSelect }>;
const nameOf = (person: { firstName: string; lastName: string } | null) => person ? `${person.firstName} ${person.lastName}`.trim() : null;
function mapList(row: ListRow, authorRole: "ADMIN" | "EDITOR" | null) {
  return { id: row.uuid, title: row.title, slug: row.slug, status: row.status,
    categoryId: row.categoryUuid, categoryName: row.category.name, authorId: row.createdByUuid,
    authorName: nameOf(row.createdBy), authorRole, isBreaking: row.isBreaking, isFeatured: row.isFeatured,
    featuredImageUrl: row.featuredImageUrl, scheduledAt: row.scheduledAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString() };
}
function mapDetail(row: DetailRow, authorRole: "ADMIN" | "EDITOR" | null) {
  return { ...mapList(row, authorRole), summary: row.summary, content: row.content,
    subcategoryId: row.subcategoryUuid, subcategoryName: row.subcategory.translations[0]?.name ?? "",
    publishedAt: row.publishedAt?.toISOString() ?? null, archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(), publishedById: row.publishedByUuid,
    tags: row.tags.map((item) => ({ id: item.tag.uuid, name: item.tag.name })),
    translations: row.translations,
    reviews: row.reviews.map((review) => ({ id: review.uuid, decision: review.decision,
      comment: review.comment, reviewerName: nameOf(review.reviewer), createdAt: review.createdAt.toISOString() })) };
}
async function rowForAction(id: string, tenantUuid: string) {
  const uuid = parse(z.string().uuid(), id);
  const row = await prisma.article.findFirst({ where: { uuid, tenantUuid },
    select: { uuid: true, status: true, createdByUuid: true, title: true, content: true,
      isBreaking: true, isFeatured: true,
      categoryUuid: true, subcategoryUuid: true, slug: true, scheduledAt: true,
      translations: { select: { locale: true, title: true, content: true } } } });
  if (!row) throw notFound("Article not found");
  return row;
}
function assertOwnOrAny(row: { createdByUuid: string | null }, session: SessionPayload, permissions: PermissionSet, own: TenantUserPermission, any: TenantUserPermission) {
  if (permissions.has(any) || (row.createdByUuid === session.userId && permissions.has(own))) return;
  throw forbidden("You do not have permission to modify this article");
}
function assertPublicationReady(row: { title: string; slug: string; content: string; categoryUuid: string; subcategoryUuid: string;
  translations: { locale: string; title: string; content: string }[] }) {
  if (!row.title.trim() || !row.slug || !row.content.trim() || !row.categoryUuid || !row.subcategoryUuid) {
    throw validationError("Title, slug, content, category and subcategory are required before publication");
  }
  if (row.translations.some((translation) => !translation.title.trim() || !translation.content.trim())) {
    throw validationError("Complete every translation before publication");
  }
}
async function validateRelations(tenantUuid: string, permissions: PermissionSet, categoryId: string, subcategoryId: string, tagIds: string[]) {
  requirePermission(permissions, "CATEGORY_VIEW");
  requirePermission(permissions, "CATEGORY_VIEW_SUBCATEGORY");
  const category = await prisma.category.findFirst({ where: { uuid: categoryId, tenantUuid }, select: { uuid: true } });
  const subcategory = await prisma.subcategory.findFirst({ where: { uuid: subcategoryId, categoryUuid: categoryId, tenantUuid }, select: { uuid: true } });
  if (!category || !subcategory) throw validationError("Select a category and one of its subcategories in this tenant");
  if (tagIds.length) {
    requirePermission(permissions, "TAG_VIEW");
    const count = await prisma.tag.count({ where: { uuid: { in: tagIds }, tenantUuid } });
    if (count !== tagIds.length) throw validationError("One or more tags do not belong to this tenant");
  }
}

export async function listArticles(session: SessionPayload, input: unknown) {
  const { tenantUuid, permissions } = await access(session);
  requirePermission(permissions, "ARTICLE_VIEW");
  const filter = parse(z.object({
    search: z.string().trim().max(160).nullish(), status: z.nativeEnum(ArticleStatus).nullish(),
    categoryId: z.string().uuid().nullish(), scope: z.enum(["ALL", "MY", "REVIEW"]).default("ALL"),
    page: z.number().int().min(1).max(100000).default(1), pageSize: z.number().int().min(1).max(100).default(25),
  }), input);
  if (filter.scope === "REVIEW") requirePermission(permissions, "ARTICLE_REVIEW");
  const where: Prisma.ArticleWhereInput = { tenantUuid,
    ...(filter.scope === "MY" ? { createdByUuid: session.userId } : {}),
    ...(filter.scope === "REVIEW" ? { status: ArticleStatus.IN_REVIEW } : filter.status ? { status: filter.status } : {}),
    ...(filter.categoryId ? { categoryUuid: filter.categoryId } : {}),
    ...(filter.search ? { OR: [
      { title: { contains: filter.search, mode: "insensitive" } },
      { slug: { contains: filter.search, mode: "insensitive" } },
      { translations: { some: { title: { contains: filter.search, mode: "insensitive" } } } },
    ] } : {}),
  };
  const [rows, total] = await prisma.$transaction([
    prisma.article.findMany({ where, select: listSelect, orderBy: [{ updatedAt: "desc" }, { uuid: "asc" }],
      skip: (filter.page - 1) * filter.pageSize, take: filter.pageSize }),
    prisma.article.count({ where }),
  ]);
  const roles = await articleAuthorRoles(tenantUuid, rows.map((row) => row.createdByUuid));
  return { items: rows.map((row) => mapList(row, roles.get(row.createdByUuid ?? "") ?? null)), total, page: filter.page, pageSize: filter.pageSize };
}

export async function getArticle(session: SessionPayload, id: string) {
  const { tenantUuid, permissions } = await access(session);
  requirePermission(permissions, "ARTICLE_VIEW");
  const row = await prisma.article.findFirst({ where: { uuid: parse(z.string().uuid(), id), tenantUuid }, select: detailSelect });
  if (!row) return null;
  const roles = await articleAuthorRoles(tenantUuid, [row.createdByUuid]);
  return mapDetail(row, roles.get(row.createdByUuid ?? "") ?? null);
}

export async function createArticle(session: SessionPayload, input: unknown) {
  const { tenantUuid, permissions } = await access(session);
  requirePermission(permissions, "ARTICLE_VIEW");
  requirePermission(permissions, "ARTICLE_CREATE");
  const data = parse(createArticleSchema, input);
  if (data.isBreaking) requirePermission(permissions, "ARTICLE_SET_BREAKING");
  if (data.isFeatured) requirePermission(permissions, "ARTICLE_SET_FEATURED");
  await validateRelations(tenantUuid, permissions, data.categoryId, data.subcategoryId, data.tagIds);
  try {
    const article = await prisma.$transaction(async (tx) => {
      const created = await tx.article.create({ data: {
        tenant: { connect: { uuid: tenantUuid } },
        createdBy: { connect: { uuid: session.userId } },
        category: { connect: { uuid_tenantUuid: { uuid: data.categoryId, tenantUuid } } },
        subcategory: { connect: { uuid_tenantUuid_categoryUuid: { uuid: data.subcategoryId, tenantUuid, categoryUuid: data.categoryId } } },
        title: data.title, slug: data.slug, summary: data.summary ?? null,
        content: data.content, featuredImageUrl: data.featuredImageUrl ?? null,
        isBreaking: data.isBreaking ?? false, isFeatured: data.isFeatured ?? false,
        translations: { create: data.translations.map((item) => ({ ...item, summary: item.summary ?? null })) },
      }, select: { uuid: true } });
      if (data.tagIds.length) await tx.articleTag.createMany({ data: data.tagIds.map((tagUuid) => ({
        articleUuid: created.uuid, tagUuid, tenantUuid,
      })) });
      await writeAuthAudit({ action: "ARTICLE_CREATED", actorUserUuid: session.userId, tenantUuid,
        targetType: "article", targetUuid: created.uuid,
        metadata: { title: data.title, status: "DRAFT", isBreaking: data.isBreaking ?? false, isFeatured: data.isFeatured ?? false } }, tx);
      for (const [kind, enabled] of [["BREAKING", data.isBreaking], ["FEATURED", data.isFeatured]] as const) {
        if (enabled) await writeAuthAudit({ action: `ARTICLE_${kind}_ENABLED`, actorUserUuid: session.userId,
          tenantUuid, targetType: "article", targetUuid: created.uuid,
          metadata: { title: data.title, status: "DRAFT" } }, tx);
      }
      return created;
    });
    return getArticle(session, article.uuid);
  } catch (error) { return mapMutationError(error); }
}

export async function updateArticle(session: SessionPayload, id: string, input: unknown) {
  const { tenantUuid, permissions } = await access(session);
  requirePermission(permissions, "ARTICLE_VIEW");
  const row = await rowForAction(id, tenantUuid);
  assertOwnOrAny(row, session, permissions, "ARTICLE_UPDATE_OWN", "ARTICLE_UPDATE_ANY");
  await assertCanManageArticleAuthor(session, row.createdByUuid);
  if (!canEditArticleStatus(row.status)) throw validationError(row.status === ArticleStatus.PUBLISHED
    ? "Published articles must be unpublished before editing"
    : "Article is locked for editing in its current status");
  const data = parse(updateArticleSchema, input);
  if (data.isBreaking !== undefined) requirePermission(permissions, "ARTICLE_SET_BREAKING");
  if (data.isFeatured !== undefined) requirePermission(permissions, "ARTICLE_SET_FEATURED");
  if (data.categoryId || data.subcategoryId || data.tagIds) {
    await validateRelations(tenantUuid, permissions, data.categoryId ?? row.categoryUuid, data.subcategoryId ?? row.subcategoryUuid, data.tagIds ?? []);
  }
  try {
    await prisma.$transaction(async (tx) => {
      await tx.article.update({ where: { uuid: row.uuid, tenantUuid, status: row.status }, data: {
        title: data.title, slug: data.slug, summary: data.summary, content: data.content,
        ...(data.categoryId ? { category: { connect: { uuid_tenantUuid: { uuid: data.categoryId, tenantUuid } } } } : {}),
        ...(data.categoryId || data.subcategoryId ? { subcategory: { connect: { uuid_tenantUuid_categoryUuid: {
          uuid: data.subcategoryId ?? row.subcategoryUuid, tenantUuid, categoryUuid: data.categoryId ?? row.categoryUuid,
        } } } } : {}),
        featuredImageUrl: data.featuredImageUrl,
        isBreaking: data.isBreaking, isFeatured: data.isFeatured,
        ...(data.translations ? { translations: { deleteMany: {}, create: data.translations.map((item) => ({ ...item, summary: item.summary ?? null })) } } : {}),
      }, select: { uuid: true } });
      if (data.tagIds) {
        await tx.articleTag.deleteMany({ where: { articleUuid: row.uuid, tenantUuid } });
        if (data.tagIds.length) await tx.articleTag.createMany({ data: data.tagIds.map((tagUuid) => ({
          articleUuid: row.uuid, tagUuid, tenantUuid,
        })) });
      }
      for (const [kind, before, after] of [["BREAKING", row.isBreaking, data.isBreaking], ["FEATURED", row.isFeatured, data.isFeatured]] as const) {
        if (after !== undefined && after !== before) await writeAuthAudit({
          action: `ARTICLE_${kind}_${after ? "ENABLED" : "DISABLED"}`, actorUserUuid: session.userId,
          tenantUuid, targetType: "article", targetUuid: row.uuid, metadata: { title: row.title, status: row.status },
        }, tx);
      }
      await writeAuthAudit({ action: "ARTICLE_UPDATED", actorUserUuid: session.userId, tenantUuid,
        targetType: "article", targetUuid: row.uuid, metadata: { changed: Object.keys(data), status: row.status } }, tx);
    });
    return getArticle(session, row.uuid);
  } catch (error) { return mapMutationError(error); }
}

export async function deleteArticle(session: SessionPayload, id: string) {
  const { tenantUuid, permissions } = await access(session);
  requirePermission(permissions, "ARTICLE_VIEW");
  const row = await rowForAction(id, tenantUuid);
  assertOwnOrAny(row, session, permissions, "ARTICLE_DELETE_OWN", "ARTICLE_DELETE_ANY");
  await assertCanManageArticleAuthor(session, row.createdByUuid);
  assertArticleTransition(row.status, "delete");
  try {
    await prisma.$transaction(async (tx) => {
      await tx.article.delete({ where: { uuid: row.uuid, tenantUuid, status: ArticleStatus.DRAFT } });
      await writeAuthAudit({ action: "ARTICLE_DELETED", actorUserUuid: session.userId, tenantUuid,
        targetType: "article", targetUuid: row.uuid, metadata: { title: row.title, previousStatus: row.status } }, tx);
    });
    return true;
  } catch (error) { return mapMutationError(error); }
}

export async function deleteArchivedArticle(session: SessionPayload, id: string) {
  const { tenantUuid, permissions } = await access(session);
  requirePermission(permissions, "ARTICLE_VIEW");
  requirePermission(permissions, "ARTICLE_DELETE_ARCHIVED");
  const row = await rowForAction(id, tenantUuid);
  assertArticleTransition(row.status, "deleteArchived");
  await assertCanManageArticleAuthor(session, row.createdByUuid);
  try {
    await prisma.$transaction(async (tx) => {
      await tx.article.delete({ where: { uuid: row.uuid, tenantUuid, status: ArticleStatus.ARCHIVED } });
      await writeAuthAudit({ action: "ARTICLE_PERMANENTLY_DELETED", actorUserUuid: session.userId, tenantUuid,
        targetType: "article", targetUuid: row.uuid, metadata: { title: row.title, previousStatus: row.status } }, tx);
    });
    return true;
  } catch (error) { return mapMutationError(error); }
}

type WorkflowAction = Exclude<ArticleAction, "delete" | "deleteArchived">;
const workflowPermissions: Record<WorkflowAction, TenantUserPermission> = {
  submit: "ARTICLE_SUBMIT", requestChanges: "ARTICLE_REQUEST_CHANGES", publish: "ARTICLE_PUBLISH",
  schedule: "ARTICLE_SCHEDULE", reschedule: "ARTICLE_SCHEDULE", cancelSchedule: "ARTICLE_SCHEDULE", unpublish: "ARTICLE_UNPUBLISH",
  archive: "ARTICLE_ARCHIVE", restore: "ARTICLE_RESTORE",
};
const nextStatus: Record<WorkflowAction, ArticleStatus> = {
  submit: ArticleStatus.IN_REVIEW, requestChanges: ArticleStatus.DRAFT, publish: ArticleStatus.PUBLISHED,
  schedule: ArticleStatus.SCHEDULED, reschedule: ArticleStatus.SCHEDULED, cancelSchedule: ArticleStatus.DRAFT, unpublish: ArticleStatus.DRAFT,
  archive: ArticleStatus.ARCHIVED, restore: ArticleStatus.DRAFT,
};
const auditActions: Record<WorkflowAction, string> = {
  submit: "ARTICLE_REVIEW_SUBMITTED", requestChanges: "ARTICLE_CHANGES_REQUESTED", publish: "ARTICLE_PUBLISHED",
  schedule: "ARTICLE_SCHEDULED", reschedule: "ARTICLE_SCHEDULE_UPDATED", cancelSchedule: "ARTICLE_SCHEDULE_CANCELLED", unpublish: "ARTICLE_UNPUBLISHED",
  archive: "ARTICLE_ARCHIVED", restore: "ARTICLE_RESTORED",
};

export async function articleWorkflow(session: SessionPayload, id: string, action: WorkflowAction, input?: unknown) {
  const { tenantUuid, permissions } = await access(session);
  requirePermission(permissions, "ARTICLE_VIEW");
  requirePermission(permissions, workflowPermissions[action]);
  const row = await rowForAction(id, tenantUuid);
  if (action === "requestChanges" && row.status === ArticleStatus.PUBLISHED) {
    throw validationError("Unpublish this article before requesting changes");
  }
  assertArticleTransition(row.status, action);
  await assertCanManageArticleAuthor(session, row.createdByUuid);
  if (action === "submit") assertOwnOrAny(row, session, permissions, "ARTICLE_UPDATE_OWN", "ARTICLE_UPDATE_ANY");
  if (action === "archive") assertOwnOrAny(row, session, permissions, "ARTICLE_UPDATE_OWN", "ARTICLE_UPDATE_ANY");
  if (action === "requestChanges" && !permissions.has("ARTICLE_REVIEW")) {
    assertOwnOrAny(row, session, permissions, "ARTICLE_UPDATE_OWN", "ARTICLE_UPDATE_ANY");
  }
  if (action === "schedule") {
    if (row.status === ArticleStatus.DRAFT) {
      assertOwnOrAny(row, session, permissions, "ARTICLE_UPDATE_OWN", "ARTICLE_UPDATE_ANY");
    } else {
      requirePermission(permissions, "ARTICLE_REVIEW");
    }
  }
  if ((action === "reschedule" || action === "cancelSchedule") && !permissions.has("ARTICLE_REVIEW")) {
    assertOwnOrAny(row, session, permissions, "ARTICLE_UPDATE_OWN", "ARTICLE_UPDATE_ANY");
  }
  if (["submit", "publish", "schedule"].includes(action)) assertPublicationReady(row);
  const comment = action === "requestChanges" ? parse(commentSchema, input) : null;
  const scheduledAt = action === "schedule" || action === "reschedule"
    ? new Date(parse(scheduleAtSchema, input)) : null;
  if (scheduledAt && (!Number.isFinite(scheduledAt.getTime()) || scheduledAt <= new Date())) {
    throw validationError("Schedule a future date and time with an explicit UTC offset");
  }
  const now = new Date();
  const data: Prisma.ArticleUpdateManyMutationInput = {
    status: nextStatus[action],
    ...(action === "publish" ? { publishedAt: now, publishedByUuid: session.userId, scheduledAt: null, scheduledByUuid: null } : {}),
    ...(action === "schedule" || action === "reschedule" ? { scheduledAt, scheduledByUuid: session.userId } : {}),
    ...(action === "cancelSchedule" ? { scheduledAt: null, scheduledByUuid: null } : {}),
    ...(action === "archive" ? { archivedAt: now } : {}),
    ...(action === "restore" ? { archivedAt: null } : {}),
  };
  try {
    await prisma.$transaction(async (tx) => {
      const changed = await tx.article.updateMany({ where: { uuid: row.uuid, tenantUuid, status: row.status,
        ...(row.status === ArticleStatus.SCHEDULED ? { scheduledAt: row.scheduledAt } : {}) }, data });
      if (changed.count !== 1) throw validationError("Article changed while this action was in progress. Refresh and try again");
      if (action === "submit" || action === "requestChanges" || ((action === "publish" || action === "schedule") && row.status === ArticleStatus.IN_REVIEW)) {
        await tx.articleReview.create({ data: { tenantUuid, articleUuid: row.uuid, reviewerUuid: session.userId,
          decision: action === "submit" ? "SUBMITTED" : action === "requestChanges" ? "CHANGES_REQUESTED" : "APPROVED", comment } });
      }
      await writeAuthAudit({ action: auditActions[action], actorUserUuid: session.userId, tenantUuid,
        targetType: "article", targetUuid: row.uuid,
        metadata: { title: row.title, previousStatus: row.status, newStatus: nextStatus[action],
          ...(action === "requestChanges" ? { comment } : {}),
          ...(scheduledAt ? { scheduledAt: scheduledAt.toISOString() } : {}) } }, tx);
    });
    return getArticle(session, row.uuid);
  } catch (error) { return mapMutationError(error); }
}

export async function setArticlePresentation(session: SessionPayload, id: string, kind: "breaking" | "featured", enabled: boolean) {
  const { tenantUuid, permissions } = await access(session);
  requirePermission(permissions, "ARTICLE_VIEW");
  requirePermission(permissions, kind === "breaking" ? "ARTICLE_SET_BREAKING" : "ARTICLE_SET_FEATURED");
  const row = await rowForAction(id, tenantUuid);
  if (row.status === ArticleStatus.PUBLISHED) {
    throw validationError("Unpublish the article before changing Breaking or Featured");
  }
  if (row.status === ArticleStatus.DRAFT) {
    assertOwnOrAny(row, session, permissions, "ARTICLE_UPDATE_OWN", "ARTICLE_UPDATE_ANY");
  } else if (row.status === ArticleStatus.IN_REVIEW || row.status === ArticleStatus.SCHEDULED) {
    requirePermission(permissions, "ARTICLE_REVIEW");
  } else {
    throw validationError("Breaking and Featured cannot be changed on an archived article");
  }
  await assertCanManageArticleAuthor(session, row.createdByUuid);
  const field = kind === "breaking" ? "isBreaking" : "isFeatured";
  await prisma.$transaction(async (tx) => {
    const changed = await tx.article.updateMany({ where: { uuid: row.uuid, tenantUuid, status: row.status }, data: { [field]: enabled } });
    if (changed.count !== 1) throw validationError("Article changed while this action was in progress. Refresh and try again");
    await writeAuthAudit({ action: `ARTICLE_${kind.toUpperCase()}_${enabled ? "ENABLED" : "DISABLED"}`,
      actorUserUuid: session.userId, tenantUuid, targetType: "article", targetUuid: row.uuid,
      metadata: { title: row.title, status: row.status } }, tx);
  });
  return getArticle(session, row.uuid);
}
