import { Prisma, TenantStatus, TenantType } from "@prisma/client";
import { prisma } from "@/src/lib/db";
import { notFound } from "@/src/lib/errors";

function settingsObject(value: Prisma.JsonValue): Record<string, Prisma.JsonValue> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, Prisma.JsonValue> : {};
}

/** Serialize writes to different Settings tabs so a stale JSON snapshot cannot erase another save. */
export function updateTenantSettingsSection<T>(
  tenantUuid: string,
  section: "general" | "website" | "seo" | "content",
  value: T,
  afterUpdate?: (previous: Prisma.JsonValue, tx: Prisma.TransactionClient) => Promise<void>,
) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`SELECT uuid FROM tenants WHERE uuid = ${tenantUuid} FOR UPDATE`);
    const where = { uuid: tenantUuid, type: TenantType.SUB, status: TenantStatus.ACTIVE, deletedAt: null };
    const tenant = await tx.tenant.findFirst({ where, select: { settings: true } });
    if (!tenant) throw notFound("Sub-tenant not found");
    const settings = { ...settingsObject(tenant.settings), [section]: value };
    const changed = await tx.tenant.updateMany({ where, data: { settings: settings as Prisma.InputJsonValue } });
    if (changed.count !== 1) throw notFound("Sub-tenant not found");
    await afterUpdate?.(tenant.settings, tx);
    return value;
  });
}
