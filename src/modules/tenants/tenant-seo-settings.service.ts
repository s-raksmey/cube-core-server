import { Prisma, TenantStatus, TenantType } from "@prisma/client";
import { z } from "zod";
import type { SessionPayload } from "@/src/lib/auth/session";
import { prisma } from "@/src/lib/db";
import { forbidden, notFound, validationError } from "@/src/lib/errors";
import { writeAuthAudit } from "@/src/modules/auth/audit-auth";
import { requireTenantUserPermission } from "@/src/modules/roles/role-permission.service";
import { brandingAssetUrl, saveBrandingAsset } from "@/src/modules/tenants/tenant-branding.service";
import { updateTenantSettingsSection } from "@/src/modules/tenants/tenant-settings-write";

export const seoSettingsInput = z.object({
  allowIndexing: z.boolean(),
  metaTitle: z.string().trim().max(160),
  metaDescription: z.string().trim().max(500),
  ogTitle: z.string().trim().max(160),
  ogDescription: z.string().trim().max(500),
}).strict();

const seoImageInput = z.object({
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
  contentBase64: z.string().min(1).max(Math.ceil((1000 * 1024) / 3) * 4).nullish(),
}).strict();

function settingsObject(settings: Prisma.JsonValue): Record<string, Prisma.JsonValue> {
  return settings && typeof settings === "object" && !Array.isArray(settings)
    ? settings as Record<string, Prisma.JsonValue> : {};
}

function mapSeo(settings: Prisma.JsonValue) {
  const seo = settingsObject(settingsObject(settings).seo ?? null);
  const value = (field: string) => typeof seo[field] === "string" ? seo[field] as string : "";
  return {
    allowIndexing: seo.allowIndexing !== false,
    metaTitle: value("metaTitle"),
    metaDescription: value("metaDescription"),
    ogTitle: value("ogTitle"),
    ogDescription: value("ogDescription"),
  };
}

function publicSeoImage(tenantUuid: string, path: string | null | undefined) {
  if (!path) return null;
  const normalized = path.replaceAll("\\", "/");
  const prefix = `tenants/${tenantUuid}/branding/`;
  return normalized.startsWith(prefix) && /^open_graph_image-\d+\.(png|jpe?g|webp)$/i.test(normalized.slice(prefix.length))
    ? brandingAssetUrl(normalized) : null;
}

function validRasterImage(mimeType: string, base64: string) {
  const bytes = Buffer.from(base64, "base64");
  if (!bytes.length || bytes.length > 1000 * 1024) return false;
  if (mimeType === "image/png") return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mimeType === "image/jpeg") return bytes.length > 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  return mimeType === "image/webp" && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
}

async function requireSettingsTenant(session: SessionPayload, permission: "SETTINGS_VIEW" | "SETTINGS_UPDATE") {
  if (session.audience !== "TENANT_APP") throw forbidden("Sub-tenant access is required");
  await requireTenantUserPermission(session, permission);
  const tenant = await prisma.tenant.findFirst({
    where: { uuid: session.tenantId, type: TenantType.SUB, status: TenantStatus.ACTIVE, deletedAt: null },
    select: { uuid: true, settings: true, branding: { select: { openGraphImagePath: true } } },
  });
  if (!tenant) throw notFound("Sub-tenant not found");
  return tenant;
}

export function publicSeoFromTenant(tenant: { uuid: string; settings: Prisma.JsonValue; branding: { openGraphImagePath: string | null } | null }) {
  return { ...mapSeo(tenant.settings), defaultOgImageUrl: publicSeoImage(tenant.uuid, tenant.branding?.openGraphImagePath) };
}

const response = publicSeoFromTenant;

export async function getMySeoSettings(session: SessionPayload) {
  return response(await requireSettingsTenant(session, "SETTINGS_VIEW"));
}

export async function updateMySeoSettings(session: SessionPayload, input: unknown) {
  const tenant = await requireSettingsTenant(session, "SETTINGS_UPDATE");
  const parsed = seoSettingsInput.safeParse(input);
  if (!parsed.success) throw validationError(parsed.error.issues[0]?.message ?? "Invalid SEO settings");
  await updateTenantSettingsSection(tenant.uuid, "seo", parsed.data);
  return { ...parsed.data, defaultOgImageUrl: publicSeoImage(tenant.uuid, tenant.branding?.openGraphImagePath) };
}

/** Uses the existing tenant branding asset storage; no Media ID or foreign tenant path is accepted. */
export async function updateMySeoImage(session: SessionPayload, input: unknown) {
  const tenant = await requireSettingsTenant(session, "SETTINGS_UPDATE");
  const parsed = seoImageInput.safeParse(input);
  if (!parsed.success) throw validationError(parsed.error.issues[0]?.message ?? "Invalid OG image");
  if (parsed.data.contentBase64 && !validRasterImage(parsed.data.mimeType, parsed.data.contentBase64)) {
    throw validationError("OG image must be a valid PNG, JPEG, or WebP file of 1,000 KB or less");
  }
  const branding = await saveBrandingAsset(tenant.uuid, { asset: "OPEN_GRAPH_IMAGE", ...parsed.data });
  await writeAuthAudit({
    action: "tenant.seo.image.updated", actorUserUuid: session.userId, tenantUuid: tenant.uuid,
    targetType: "tenant", targetUuid: tenant.uuid,
    metadata: { operation: parsed.data.contentBase64 ? "uploaded" : "removed" },
  });
  return branding.openGraphImageUrl;
}

/** Public field on the existing hostname-resolved General config. */
export async function getPublicSeoSettingsForTenant(tenantUuid: string) {
  const tenant = await prisma.tenant.findFirst({
    where: { uuid: tenantUuid, type: TenantType.SUB, status: TenantStatus.ACTIVE, deletedAt: null },
    select: { uuid: true, settings: true, branding: { select: { openGraphImagePath: true } } },
  });
  return tenant ? response(tenant) : null;
}
