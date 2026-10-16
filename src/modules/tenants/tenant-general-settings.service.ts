import { Prisma, TenantStatus, TenantType } from "@prisma/client";
import { z } from "zod";
import type { SessionPayload } from "@/src/lib/auth/session";
import { prisma } from "@/src/lib/db";
import { forbidden, notFound, validationError } from "@/src/lib/errors";
import { writeAuthAudit } from "@/src/modules/auth/audit-auth";
import { requireTenantUserPermission } from "@/src/modules/roles/role-permission.service";
import { findActiveWebsiteTenantUuidByHostname } from "@/src/modules/tenants/tenant-domain.service";
import { findLocalDevelopmentTenant } from "@/src/modules/tenants/local-development-tenant.service";
import { updateTenantSettingsSection } from "@/src/modules/tenants/tenant-settings-write";
import { publicSeoFromTenant } from "@/src/modules/tenants/tenant-seo-settings.service";

const phone = z.string().trim().max(30).refine(
  (value) => value === "" || (/^[+()\d\s.-]+$/.test(value) && /\d/.test(value) && value.length >= 5),
  "Enter a valid phone number",
);

export const generalSettingsInput = z.object({
  siteName: z.string().trim().min(1).max(120),
  siteDescription: z.string().trim().max(500),
  contactEmail: z.string().trim().max(254).refine(
    (value) => value === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
    "Enter a valid contact email",
  ),
  phone,
  secondaryPhone: phone.nullish().transform((value) => value || null),
  address: z.string().trim().max(500),
}).strict();

type GeneralSettings = z.infer<typeof generalSettingsInput>;

export const websiteSettingsInput = z.object({
  maintenanceMode: z.boolean(),
  maintenanceMessage: z.string().trim().max(1000).nullish().transform((value) => value || null),
}).strict();

type WebsiteSettings = z.infer<typeof websiteSettingsInput>;

function settingsObject(settings: Prisma.JsonValue): Record<string, Prisma.JsonValue> {
  return settings && typeof settings === "object" && !Array.isArray(settings)
    ? settings as Record<string, Prisma.JsonValue>
    : {};
}

function mapGeneral(name: string, settings: Prisma.JsonValue): GeneralSettings {
  const general = settingsObject(settings).general;
  const stored = general && typeof general === "object" && !Array.isArray(general)
    ? general as Record<string, Prisma.JsonValue>
    : {};
  const text = (key: string) => typeof stored[key] === "string" ? stored[key] as string : "";
  return {
    siteName: text("siteName") || name,
    siteDescription: text("siteDescription"),
    contactEmail: text("contactEmail"),
    phone: text("phone"),
    secondaryPhone: text("secondaryPhone") || null,
    address: text("address"),
  };
}

function mapWebsite(settings: Prisma.JsonValue): WebsiteSettings {
  const website = settingsObject(settings).website;
  const stored = settingsObject(website ?? null);
  return {
    maintenanceMode: stored.maintenanceMode === true,
    maintenanceMessage: typeof stored.maintenanceMessage === "string" ? stored.maintenanceMessage : null,
  };
}

function requireTenantSession(session: SessionPayload) {
  if (session.audience !== "TENANT_APP") throw forbidden("Sub-tenant access is required");
}

export async function getMyGeneralSettings(session: SessionPayload) {
  requireTenantSession(session);
  await requireTenantUserPermission(session, "SETTINGS_VIEW");
  const tenant = await prisma.tenant.findFirst({
    where: { uuid: session.tenantId, type: TenantType.SUB, status: TenantStatus.ACTIVE, deletedAt: null },
    select: { name: true, settings: true },
  });
  if (!tenant) throw notFound("Sub-tenant not found");
  return mapGeneral(tenant.name, tenant.settings);
}

export async function updateMyGeneralSettings(session: SessionPayload, input: unknown) {
  requireTenantSession(session);
  await requireTenantUserPermission(session, "SETTINGS_UPDATE");
  const parsed = generalSettingsInput.safeParse(input);
  if (!parsed.success) throw validationError(parsed.error.issues[0]?.message ?? "Invalid General settings");
  return updateTenantSettingsSection(session.tenantId, "general", parsed.data);
}

export async function getMyWebsiteSettings(session: SessionPayload) {
  requireTenantSession(session);
  await requireTenantUserPermission(session, "SETTINGS_VIEW");
  const tenant = await prisma.tenant.findFirst({
    where: { uuid: session.tenantId, type: TenantType.SUB, status: TenantStatus.ACTIVE, deletedAt: null },
    select: { settings: true },
  });
  if (!tenant) throw notFound("Sub-tenant not found");
  return mapWebsite(tenant.settings);
}

export async function updateMyWebsiteSettings(session: SessionPayload, input: unknown) {
  requireTenantSession(session);
  await requireTenantUserPermission(session, "SETTINGS_UPDATE");
  const parsed = websiteSettingsInput.safeParse(input);
  if (!parsed.success) throw validationError(parsed.error.issues[0]?.message ?? "Invalid Website settings");
  return updateTenantSettingsSection(session.tenantId, "website", parsed.data, async (previous, tx) => {
    const before = mapWebsite(previous);
    if (before.maintenanceMode !== parsed.data.maintenanceMode) {
      await writeAuthAudit({
        action: parsed.data.maintenanceMode ? "tenant.website.maintenance.enabled" : "tenant.website.maintenance.disabled",
        actorUserUuid: session.userId,
        tenantUuid: session.tenantId,
        targetType: "tenant",
        targetUuid: session.tenantId,
        metadata: { maintenanceMode: parsed.data.maintenanceMode },
      }, tx);
    }
  });
}

/** Public data is resolved from the website hostname, never from a caller-supplied tenant ID. */
export async function getPublicGeneralSettings(hostname: string) {
  const tenantUuid = hostname === "localhost"
    ? (await findLocalDevelopmentTenant())?.uuid
    : await findActiveWebsiteTenantUuidByHostname(hostname);
  if (!tenantUuid) return null;
  const tenant = await prisma.tenant.findFirst({
    where: { uuid: tenantUuid, type: TenantType.SUB, status: TenantStatus.ACTIVE, deletedAt: null },
    select: { uuid: true, name: true, settings: true,
      branding: { select: { openGraphImagePath: true } },
      socialLinks: { where: { enabled: true }, select: { platform: true, url: true, sortOrder: true },
        orderBy: [{ sortOrder: "asc" }, { platform: "asc" }] },
    },
  });
  return tenant ? { ...mapGeneral(tenant.name, tenant.settings), website: mapWebsite(tenant.settings),
    tenantUuid, socialLinks: tenant.socialLinks, seo: publicSeoFromTenant(tenant),
  } : null;
}
