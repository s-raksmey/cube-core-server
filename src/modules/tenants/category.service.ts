import { TenantType } from "@prisma/client";
import { z } from "zod";
import type { SessionPayload } from "@/src/lib/auth/session";
import { prisma } from "@/src/lib/db";
import { forbidden, notFound, validationError } from "@/src/lib/errors";
import { getTenantUserPermissions, requireTenantUserPermission, type TenantUserPermission } from "@/src/modules/roles/role-permission.service";

const translation = z.object({ locale: z.string().trim().toLowerCase().regex(/^[a-z]{2,8}(?:-[a-z0-9]{2,8})?$/), name: z.string().trim().min(1).max(160) });
const categoryInput = z.object({ slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(120), translations: z.array(translation).min(1).superRefine((items, ctx) => { if (new Set(items.map((item) => item.locale)).size !== items.length) ctx.addIssue({ code: "custom", message: "Translation locales must be unique" }); }) });
const updateInput = categoryInput.partial();
const subcategoryInput = categoryInput.extend({ categoryId: z.string().uuid() });
const includeCategory = {
  translations: { select: { locale: true, name: true }, orderBy: { locale: "asc" as const } },
  subcategories: {
    include: { translations: { select: { locale: true, name: true }, orderBy: { locale: "asc" as const } } },
    orderBy: { slug: "asc" as const },
  },
};
const includeCategoryWithoutSubcategories = { translations: { select: { locale: true, name: true }, orderBy: { locale: "asc" as const } } };
const includeSubcategory = { translations: { select: { locale: true, name: true }, orderBy: { locale: "asc" as const } } };

async function requireTenant(session: SessionPayload, permission: TenantUserPermission) {
  if (session.audience !== "TENANT_APP" || session.role === "SUPERADMIN") throw forbidden("Sub-tenant access is required");
  const tenant = await prisma.tenant.findFirst({ where: { uuid: session.tenantId, type: TenantType.SUB, deletedAt: null }, select: { uuid: true } });
  if (!tenant) throw forbidden("Sub-tenant access is required");
  await requireTenantUserPermission(session, permission);
  return tenant.uuid;
}
function mapCategory(row: any) { return { id: row.uuid, slug: row.slug, name: row.name, translations: row.translations, subcategories: row.subcategories?.map(mapSubcategory) ?? [], createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() }; }
function mapSubcategory(row: any) { return { id: row.uuid, categoryId: row.categoryUuid, slug: row.slug, translations: row.translations, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() }; }
function parse<T>(schema: z.ZodType<T>, value: unknown) { const parsed = schema.safeParse(value); if (!parsed.success) throw validationError(parsed.error.issues[0]?.message ?? "Invalid category input"); return parsed.data; }
function englishName(translations: { locale: string; name: string }[]) { const value = translations.find((translation) => translation.locale === "en")?.name; if (!value) throw validationError("An English category name is required"); return value; }

export async function listCategories(session: SessionPayload, search?: string | null) { const tenantId = await requireTenant(session, "CATEGORY_VIEW"); const canViewSubcategories = (await getTenantUserPermissions(session)).includes("CATEGORY_VIEW_SUBCATEGORY"); const value = search?.trim(); const rows = await prisma.category.findMany({ where: { tenantUuid: tenantId, ...(value ? { OR: [{ slug: { contains: value, mode: "insensitive" } }, { translations: { some: { name: { contains: value, mode: "insensitive" } } } }] } : {}) }, include: canViewSubcategories ? includeCategory : includeCategoryWithoutSubcategories, orderBy: { slug: "asc" } }); return rows.map(mapCategory); }
export async function getCategory(session: SessionPayload, id: string) { const tenantId = await requireTenant(session, "CATEGORY_VIEW"); const canViewSubcategories = (await getTenantUserPermissions(session)).includes("CATEGORY_VIEW_SUBCATEGORY"); const row = await prisma.category.findFirst({ where: { uuid: id, tenantUuid: tenantId }, include: canViewSubcategories ? includeCategory : includeCategoryWithoutSubcategories }); return row ? mapCategory(row) : null; }
export async function createCategory(session: SessionPayload, input: unknown) { const tenantId = await requireTenant(session, "CATEGORY_CREATE"); const data = parse(categoryInput, input); try { return mapCategory(await prisma.category.create({ data: { tenantUuid: tenantId, slug: data.slug, name: englishName(data.translations), translations: { create: data.translations } }, include: includeCategory })); } catch { throw validationError("A category with this slug already exists"); } }
export async function updateCategory(session: SessionPayload, id: string, input: unknown) { const tenantId = await requireTenant(session, "CATEGORY_EDIT"); const data = parse(updateInput, input); const existing = await prisma.category.findFirst({ where: { uuid: id, tenantUuid: tenantId }, select: { uuid: true } }); if (!existing) throw notFound("Category not found"); try { return mapCategory(await prisma.category.update({ where: { uuid: id }, data: { ...(data.slug ? { slug: data.slug } : {}), ...(data.translations ? { name: englishName(data.translations), translations: { deleteMany: {}, create: data.translations } } : {}) }, include: includeCategory })); } catch { throw validationError("A category with this slug already exists"); } }
export async function deleteCategory(session: SessionPayload, id: string) { const tenantId = await requireTenant(session, "CATEGORY_DELETE"); const row = await prisma.category.findFirst({ where: { uuid: id, tenantUuid: tenantId }, select: { uuid: true } }); if (!row) throw notFound("Category not found"); await prisma.category.delete({ where: { uuid: id } }); return true; }
export async function listSubcategories(session: SessionPayload, categoryId?: string | null, search?: string | null) { const tenantId = await requireTenant(session, "CATEGORY_VIEW_SUBCATEGORY"); const value = search?.trim(); const rows = await prisma.subcategory.findMany({ where: { tenantUuid: tenantId, ...(categoryId ? { categoryUuid: categoryId } : {}), ...(value ? { OR: [{ slug: { contains: value, mode: "insensitive" } }, { translations: { some: { name: { contains: value, mode: "insensitive" } } } }] } : {}) }, include: includeSubcategory, orderBy: { slug: "asc" } }); return rows.map(mapSubcategory); }
export async function getSubcategory(session: SessionPayload, id: string) { const tenantId = await requireTenant(session, "CATEGORY_VIEW_SUBCATEGORY"); const row = await prisma.subcategory.findFirst({ where: { uuid: id, tenantUuid: tenantId }, include: includeSubcategory }); return row ? mapSubcategory(row) : null; }
export async function createSubcategory(session: SessionPayload, input: unknown) { const tenantId = await requireTenant(session, "CATEGORY_CREATE_SUBCATEGORY"); const data = parse(subcategoryInput, input); const parent = await prisma.category.findFirst({ where: { uuid: data.categoryId, tenantUuid: tenantId }, select: { uuid: true } }); if (!parent) throw notFound("Category not found"); try { return mapSubcategory(await prisma.subcategory.create({ data: { tenantUuid: tenantId, categoryUuid: data.categoryId, slug: data.slug, translations: { create: data.translations } }, include: includeSubcategory })); } catch { throw validationError("A subcategory with this slug already exists"); } }
export async function updateSubcategory(session: SessionPayload, id: string, input: unknown) { const tenantId = await requireTenant(session, "CATEGORY_EDIT_SUBCATEGORY"); const data = parse(updateInput, input); const existing = await prisma.subcategory.findFirst({ where: { uuid: id, tenantUuid: tenantId }, select: { uuid: true } }); if (!existing) throw notFound("Subcategory not found"); try { return mapSubcategory(await prisma.subcategory.update({ where: { uuid: id }, data: { ...(data.slug ? { slug: data.slug } : {}), ...(data.translations ? { name: englishName(data.translations), translations: { deleteMany: {}, create: data.translations } } : {}) }, include: includeSubcategory })); } catch { throw validationError("A subcategory with this slug already exists"); } }
export async function deleteSubcategory(session: SessionPayload, id: string) { const tenantId = await requireTenant(session, "CATEGORY_DELETE_SUBCATEGORY"); const row = await prisma.subcategory.findFirst({ where: { uuid: id, tenantUuid: tenantId }, select: { uuid: true } }); if (!row) throw notFound("Subcategory not found"); await prisma.subcategory.delete({ where: { uuid: id } }); return true; }


