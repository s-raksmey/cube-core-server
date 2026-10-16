import { Prisma, TenantStatus, TenantType } from "@prisma/client";
import { z } from "zod";
import type { SessionPayload } from "@/src/lib/auth/session";
import { prisma } from "@/src/lib/db";
import { forbidden, notFound, validationError } from "@/src/lib/errors";
import { requireTenantUserPermission } from "@/src/modules/roles/role-permission.service";
import { updateTenantSettingsSection } from "@/src/modules/tenants/tenant-settings-write";

const MAX_BREAKING_MINUTES = 30 * 24 * 60;
export const contentSettingsInput = z.object({
  breakingDurationValue: z.number().int().positive(),
  breakingDurationUnit: z.enum(["HOURS", "DAYS"]),
}).strict().refine(({ breakingDurationValue, breakingDurationUnit }) =>
  breakingDurationValue * (breakingDurationUnit === "DAYS" ? 1440 : 60) <= MAX_BREAKING_MINUTES,
  "Breaking duration cannot exceed 30 days",
);

type ContentSettings = z.infer<typeof contentSettingsInput>;
const defaults: ContentSettings = { breakingDurationValue: 24, breakingDurationUnit: "HOURS" };

function object(value: Prisma.JsonValue): Record<string, Prisma.JsonValue> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, Prisma.JsonValue> : {};
}

export function contentSettingsFromJson(settings: Prisma.JsonValue): ContentSettings {
  const stored = object(object(settings).content ?? null);
  const parsed = contentSettingsInput.safeParse(stored);
  return parsed.success ? parsed.data : defaults;
}

export function breakingExpiresAt(publishedAt: Date, settings: Prisma.JsonValue) {
  const { breakingDurationValue, breakingDurationUnit } = contentSettingsFromJson(settings);
  const minutes = breakingDurationValue * (breakingDurationUnit === "DAYS" ? 1440 : 60);
  return new Date(publishedAt.getTime() + minutes * 60_000);
}

async function authorizedTenant(session: SessionPayload, permission: "SETTINGS_VIEW" | "SETTINGS_UPDATE") {
  if (session.audience !== "TENANT_APP") throw forbidden("Sub-tenant access is required");
  await requireTenantUserPermission(session, permission);
  const where = { uuid: session.tenantId, type: TenantType.SUB, status: TenantStatus.ACTIVE, deletedAt: null };
  const tenant = await prisma.tenant.findFirst({ where, select: { settings: true } });
  if (!tenant) throw notFound("Sub-tenant not found");
  return { where, settings: tenant.settings };
}

export async function getMyContentSettings(session: SessionPayload) {
  return contentSettingsFromJson((await authorizedTenant(session, "SETTINGS_VIEW")).settings);
}

export async function updateMyContentSettings(session: SessionPayload, input: unknown) {
  if (session.audience !== "TENANT_APP") throw forbidden("Sub-tenant access is required");
  await requireTenantUserPermission(session, "SETTINGS_UPDATE");
  const parsed = contentSettingsInput.safeParse(input);
  if (!parsed.success) throw validationError(parsed.error.issues[0]?.message ?? "Invalid Content settings");
  return updateTenantSettingsSection(session.tenantId, "content", parsed.data);
}
