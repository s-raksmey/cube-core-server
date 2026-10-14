import { Prisma, TenantType } from "@prisma/client";
import { z } from "zod";
import type { SessionPayload } from "@/src/lib/auth/session";
import { prisma } from "@/src/lib/db";
import { forbidden, notFound, validationError } from "@/src/lib/errors";
import { requireTenantUserPermission, type TenantUserPermission } from "@/src/modules/roles/role-permission.service";

export const tagTranslationSchema = z.object({
  locale: z.string().trim().toLowerCase().regex(/^[a-z]{2,8}(?:-[a-z0-9]{2,8})?$/).refine(value => value !== "en", "English is the default name, not an additional translation"),
  name: z.string().trim().min(1).max(160),
});
export const createTagSchema = z.object({
  name: z.string().trim().min(1).max(160),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(120),
  translations: z.array(tagTranslationSchema).max(50).default([]).superRefine((items, ctx) => {
    if (new Set(items.map(item => item.locale)).size !== items.length) ctx.addIssue({ code: "custom", message: "Translation locales must be unique" });
  }),
});
export const updateTagSchema = createTagSchema.omit({ translations: true }).partial().extend({ translations: createTagSchema.shape.translations.removeDefault().optional() });
const tagSelect = {
  uuid: true, name: true, slug: true, createdAt: true, updatedAt: true,
  translations: { select: { locale: true, name: true }, orderBy: { locale: "asc" } },
} satisfies Prisma.TagSelect;
type TagRow = Prisma.TagGetPayload<{ select: typeof tagSelect }>;
function mapTag(row: TagRow) {
  return { id: row.uuid, name: row.name, slug: row.slug, translations: row.translations, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}
async function requireTenant(session: SessionPayload, permission: TenantUserPermission) {
  if (session.audience !== "TENANT_APP") throw forbidden("Sub-tenant access is required");
  const tenant = await prisma.tenant.findFirst({ where: { uuid: session.tenantId, type: TenantType.SUB, deletedAt: null }, select: { uuid: true } });
  if (!tenant) throw forbidden("Sub-tenant access is required");
  await requireTenantUserPermission(session, permission);
  return tenant.uuid;
}
function parse<T>(schema: z.ZodType<T>, value: unknown) {
  const result = schema.safeParse(value);
  if (!result.success) throw validationError(result.error.issues[0]?.message ?? "Invalid tag input");
  return result.data;
}
function mutationError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") throw validationError("A tag with this slug already exists");
    if (error.code === "P2025") throw notFound("Tag not found");
  }
  throw error;
}
export async function listTags(session: SessionPayload, search?: string | null, page = 1, pageSize = 25) {
  const tenantUuid = await requireTenant(session, "TAG_VIEW");
  const pagination = parse(z.object({ page: z.number().int().min(1).max(100000), pageSize: z.number().int().min(1).max(100) }), { page, pageSize });
  const query = parse(z.string().trim().max(160).optional(), search ?? undefined);
  return (await prisma.tag.findMany({
    where: { tenantUuid, ...(query ? { OR: [{ name: { contains: query, mode: "insensitive" as const } }, { slug: { contains: query, mode: "insensitive" as const } }, { translations: { some: { name: { contains: query, mode: "insensitive" as const } } } }] } : {}) },
    select: tagSelect, orderBy: [{ name: "asc" }, { uuid: "asc" }], skip: (pagination.page - 1) * pagination.pageSize, take: pagination.pageSize,
  })).map(mapTag);
}
export async function getTag(session: SessionPayload, id: string) {
  const tenantUuid = await requireTenant(session, "TAG_VIEW");
  const row = await prisma.tag.findFirst({ where: { uuid: parse(z.string().uuid(), id), tenantUuid }, select: tagSelect });
  return row ? mapTag(row) : null;
}
export async function createTag(session: SessionPayload, input: unknown) {
  const tenantUuid = await requireTenant(session, "TAG_CREATE");
  const data = parse(createTagSchema, input);
  try { return mapTag(await prisma.tag.create({ data: { tenantUuid, name: data.name, slug: data.slug, translations: { create: data.translations } }, select: tagSelect })); }
  catch (error) { return mutationError(error); }
}
export async function updateTag(session: SessionPayload, id: string, input: unknown) {
  const tenantUuid = await requireTenant(session, "TAG_EDIT");
  const uuid = parse(z.string().uuid(), id);
  const data = parse(updateTagSchema, input);
  try { return mapTag(await prisma.tag.update({ where: { uuid, tenantUuid }, data: { name: data.name, slug: data.slug, ...(data.translations !== undefined ? { translations: { deleteMany: {}, create: data.translations } } : {}) }, select: tagSelect })); }
  catch (error) { return mutationError(error); }
}
export async function deleteTag(session: SessionPayload, id: string) {
  const tenantUuid = await requireTenant(session, "TAG_DELETE");
  try { await prisma.tag.delete({ where: { uuid: parse(z.string().uuid(), id), tenantUuid } }); return true; }
  catch (error) { return mutationError(error); }
}

