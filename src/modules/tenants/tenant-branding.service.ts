import { mkdir, rm, writeFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { TenantType } from "@prisma/client";
import { prisma } from "@/src/lib/db";
import { forbidden, validationError } from "@/src/lib/errors";
import type { SessionPayload } from "@/src/lib/auth/session";
import { requireTenantUserPermission } from "@/src/modules/roles/role-permission.service";
import { writeAuthAudit } from "@/src/modules/auth/audit-auth";

export type BrandingAsset = "MANAGEMENT_LOGO" | "WEBSITE_LOGO" | "FAVICON" | "PUBLIC_WEBSITE_FAVICON" | "OPEN_GRAPH_IMAGE";
const fieldByAsset = { MANAGEMENT_LOGO: "managementLogoPath", WEBSITE_LOGO: "websiteLogoPath", FAVICON: "faviconPath", PUBLIC_WEBSITE_FAVICON: "publicWebsiteFaviconPath", OPEN_GRAPH_IMAGE: "openGraphImagePath" } as const;
const mimeExtensions: Record<string, readonly string[]> = {
  "image/png": [".png"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/webp": [".webp"],
  "image/svg+xml": [".svg"],
  "image/x-icon": [".ico"],
  "image/vnd.microsoft.icon": [".ico"],
};
const storageRoot = resolve(process.env.LOCAL_STORAGE_PATH ?? join(process.cwd(), "storage"));

export function brandingAssetUrl(path: string | null) { return path ? `/storage/${path.replaceAll("\\", "/")}` : null; }
function map(row: { tenantUuid: string; managementLogoPath: string | null; websiteLogoPath: string | null; faviconPath: string | null; publicWebsiteFaviconPath: string | null; openGraphImagePath: string | null }) {
  return { tenantId: row.tenantUuid, managementLogoUrl: brandingAssetUrl(row.managementLogoPath), websiteLogoUrl: brandingAssetUrl(row.websiteLogoPath), faviconUrl: brandingAssetUrl(row.faviconPath), publicWebsiteFaviconUrl: brandingAssetUrl(row.publicWebsiteFaviconPath), openGraphImageUrl: brandingAssetUrl(row.openGraphImagePath) };
}
async function requireSubTenant(session: SessionPayload, tenantId: string, permission: "BRANDING_VIEW" | "BRANDING_UPDATE") {
  if (session.role === "SUPERADMIN") {
    if (session.audience !== "ADMIN_CONSOLE") throw forbidden("SuperAdmin console access is required");
  } else {
    if (session.tenantId !== tenantId || session.audience !== "TENANT_APP") throw forbidden("You can only manage your own tenant branding");
  }
  await requireTenantUserPermission(session, permission);
  const tenant = await prisma.tenant.findFirst({ where: { uuid: tenantId, type: TenantType.SUB, deletedAt: null }, select: { uuid: true } });
  if (!tenant) throw validationError("Sub-tenant not found");
}
export async function getTenantBranding(session: SessionPayload, tenantId: string, own = false) {
  await requireSubTenant(session, own ? session.tenantId : tenantId, "BRANDING_VIEW");
  const id = own ? session.tenantId : tenantId;
  const row = await prisma.tenantBranding.upsert({ where: { tenantUuid: id }, create: { tenantUuid: id }, update: {} });
  return map(row);
}

/**
 * Brand assets are public tenant identity, so every authenticated tenant user
 * may load them for the console chrome. Editing them remains permission-gated.
 */
export async function getMyTenantBranding(session: SessionPayload) {
  if (session.role === "SUPERADMIN" || session.audience !== "TENANT_APP") {
    throw forbidden("Tenant console access is required");
  }

  const tenant = await prisma.tenant.findFirst({
    where: { uuid: session.tenantId, type: TenantType.SUB, deletedAt: null },
    select: { uuid: true },
  });
  if (!tenant) throw validationError("Sub-tenant not found");

  const row = await prisma.tenantBranding.upsert({
    where: { tenantUuid: session.tenantId },
    create: { tenantUuid: session.tenantId },
    update: {},
  });
  return map(row);
}

async function requireMainTenant(session: SessionPayload) {
  if (session.role !== "SUPERADMIN" || session.audience !== "ADMIN_CONSOLE") {
    throw forbidden("SuperAdmin console access is required");
  }
  const tenant = await prisma.tenant.findFirst({
    where: { uuid: session.tenantId, type: TenantType.MAIN, deletedAt: null },
    select: { uuid: true },
  });
  if (!tenant) throw validationError("Main tenant not found");
  return tenant.uuid;
}

export async function getMainTenantBranding(session: SessionPayload) {
  const id = await requireMainTenant(session);
  const row = await prisma.tenantBranding.upsert({
    where: { tenantUuid: id },
    create: { tenantUuid: id },
    update: {},
  });
  return map(row);
}

/** Public identity assets are needed on the Main Tenant sign-in landing page. */
export async function getPublicMainTenantBranding() {
  const tenant = await prisma.tenant.findFirst({
    where: { type: TenantType.MAIN, deletedAt: null },
    select: { uuid: true },
  });
  if (!tenant) throw validationError("Main tenant not found");

  const row = await prisma.tenantBranding.upsert({
    where: { tenantUuid: tenant.uuid },
    create: { tenantUuid: tenant.uuid },
    update: {},
  });
  return map(row);
}

async function saveBrandingAsset(
  id: string,
  input: { asset: BrandingAsset; fileName: string; mimeType: string; contentBase64?: string | null },
) {
  const field = fieldByAsset[input.asset];
  if (!input.contentBase64) {
    const row = await prisma.tenantBranding.upsert({ where: { tenantUuid: id }, create: { tenantUuid: id }, update: { [field]: null } });
    return map(row);
  }
  if (!mimeExtensions[input.mimeType]) throw validationError("Unsupported image type");
  const data = Buffer.from(input.contentBase64, "base64");
  if (!data.length || data.length > 1000 * 1024) throw validationError("Image must be 1,000 KB or smaller");
  const extension = extname(basename(input.fileName)).toLowerCase();
  if (!extension || !mimeExtensions[input.mimeType].includes(extension)) throw validationError("File extension does not match the image type");
  const relative = join("tenants", id, "branding", `${input.asset.toLowerCase()}-${Date.now()}${extension}`);
  const destination = resolve(storageRoot, relative);
  if (!destination.startsWith(`${storageRoot}\\`) && !destination.startsWith(`${storageRoot}/`)) throw forbidden("Invalid storage path");
  await mkdir(resolve(destination, ".."), { recursive: true });
  await writeFile(destination, data, { mode: 0o600 });
  const previous = await prisma.tenantBranding.findUnique({ where: { tenantUuid: id }, select: { [field]: true } });
  if (previous?.[field] && previous[field] !== relative) await rm(resolve(storageRoot, previous[field]), { force: true });
  const row = await prisma.tenantBranding.upsert({ where: { tenantUuid: id }, create: { tenantUuid: id, [field]: relative }, update: { [field]: relative } });
  return map(row);
}

export async function updateMainTenantBranding(
  session: SessionPayload,
  input: { asset: BrandingAsset; fileName: string; mimeType: string; contentBase64?: string | null },
) {
  const tenantId = await requireMainTenant(session);
  const branding = await saveBrandingAsset(tenantId, input);
  await writeAuthAudit({
    action: "tenant.branding.updated",
    actorUserUuid: session.userId,
    tenantUuid: tenantId,
    targetType: "tenant",
    targetUuid: tenantId,
    metadata: { asset: input.asset, operation: input.contentBase64 ? "uploaded" : "removed" },
  });
  return branding;
}

export async function updateTenantBranding(session: SessionPayload, tenantId: string, input: { asset: BrandingAsset; fileName: string; mimeType: string; contentBase64?: string | null }, own = false) {
  const id = own ? session.tenantId : tenantId;
  await requireSubTenant(session, id, "BRANDING_UPDATE");
  const branding = await saveBrandingAsset(id, input);
  await writeAuthAudit({
    action: "tenant.branding.updated",
    actorUserUuid: session.userId,
    tenantUuid: id,
    targetType: "tenant",
    targetUuid: id,
    metadata: { asset: input.asset, operation: input.contentBase64 ? "uploaded" : "removed" },
  });
  return branding;
}
