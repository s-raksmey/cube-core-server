import { Prisma, SocialPlatform, TenantStatus, TenantType } from "@prisma/client";
import { z } from "zod";
import type { SessionPayload } from "@/src/lib/auth/session";
import { prisma } from "@/src/lib/db";
import { forbidden, notFound, validationError } from "@/src/lib/errors";
import { writeAuthAudit } from "@/src/modules/auth/audit-auth";
import { requireTenantUserPermission } from "@/src/modules/roles/role-permission.service";

const allowedDomains: Record<SocialPlatform, readonly string[]> = {
  FACEBOOK: ["facebook.com", "fb.com"],
  TELEGRAM: ["t.me", "telegram.me"],
  YOUTUBE: ["youtube.com", "youtu.be"],
  TIKTOK: ["tiktok.com"],
  INSTAGRAM: ["instagram.com"],
  X: ["x.com", "twitter.com"],
  LINKEDIN: ["linkedin.com"],
};

function validPlatformUrl(platform: SocialPlatform, value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
    const host = url.hostname.toLowerCase();
    return allowedDomains[platform].some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

export const socialLinksInput = z.array(z.object({
  platform: z.enum(SocialPlatform),
  url: z.string().trim().max(2048),
  enabled: z.boolean(),
  sortOrder: z.number().int().min(0).max(1000),
}).strict()).max(7).superRefine((links, ctx) => {
  if (new Set(links.map((link) => link.platform)).size !== links.length) {
    ctx.addIssue({ code: "custom", message: "Each social platform may appear only once" });
  }
  links.forEach((link, index) => {
    if (!link.url && link.enabled) {
      ctx.addIssue({ code: "custom", path: [index, "url"], message: "An enabled social link needs a URL" });
    } else if (link.url && !validPlatformUrl(link.platform, link.url)) {
      ctx.addIssue({ code: "custom", path: [index, "url"], message: `Enter a valid HTTPS ${link.platform} URL` });
    }
  });
});

const socialLinkSelect = {
  platform: true, url: true, enabled: true, sortOrder: true,
} satisfies Prisma.TenantSocialLinkSelect;

const publicSocialLinkSelect = {
  platform: true, url: true, sortOrder: true,
} satisfies Prisma.TenantSocialLinkSelect;

const orderBy = [{ sortOrder: "asc" }, { platform: "asc" }] satisfies Prisma.TenantSocialLinkOrderByWithRelationInput[];

async function requireSettingsTenant(session: SessionPayload, permission: "SETTINGS_VIEW" | "SETTINGS_UPDATE") {
  if (session.audience !== "TENANT_APP") throw forbidden("Sub-tenant access is required");
  await requireTenantUserPermission(session, permission);
  const tenant = await prisma.tenant.findFirst({
    where: { uuid: session.tenantId, type: TenantType.SUB, status: TenantStatus.ACTIVE, deletedAt: null },
    select: { uuid: true },
  });
  if (!tenant) throw notFound("Sub-tenant not found");
  return tenant.uuid;
}

export async function listMySocialLinks(session: SessionPayload) {
  const tenantUuid = await requireSettingsTenant(session, "SETTINGS_VIEW");
  return prisma.tenantSocialLink.findMany({
    where: { tenantUuid }, select: socialLinkSelect, orderBy,
  });
}

/** A single Settings save replaces this tenant's seven platform rows; blank disabled rows are removed. */
export async function updateMySocialLinks(session: SessionPayload, input: unknown) {
  const tenantUuid = await requireSettingsTenant(session, "SETTINGS_UPDATE");
  const parsed = socialLinksInput.safeParse(input);
  if (!parsed.success) throw validationError(parsed.error.issues[0]?.message ?? "Invalid social links");
  const links = parsed.data.filter((link) => link.url);
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`SELECT uuid FROM tenants WHERE uuid = ${tenantUuid} FOR UPDATE`);
    const active = await tx.tenant.findFirst({
      where: { uuid: tenantUuid, type: TenantType.SUB, status: TenantStatus.ACTIVE, deletedAt: null },
      select: { uuid: true },
    });
    if (!active) throw notFound("Sub-tenant not found");
    await tx.tenantSocialLink.deleteMany({
      where: { tenantUuid, ...(links.length ? { platform: { notIn: links.map((link) => link.platform) } } : {}) },
    });
    for (const link of links) {
      await tx.tenantSocialLink.upsert({
        where: { tenantUuid_platform: { tenantUuid, platform: link.platform } },
        create: { tenantUuid, ...link },
        update: { url: link.url, enabled: link.enabled, sortOrder: link.sortOrder },
      });
    }
    await writeAuthAudit({
      action: "tenant.social_links.updated",
      actorUserUuid: session.userId,
      tenantUuid,
      targetType: "tenant",
      targetUuid: tenantUuid,
      metadata: { count: links.length },
    }, tx);
    return tx.tenantSocialLink.findMany({ where: { tenantUuid }, select: socialLinkSelect, orderBy });
  });
}

/** Called only by the public config field resolver after hostname resolution. */
export function listPublicSocialLinksForTenant(tenantUuid: string) {
  return prisma.tenantSocialLink.findMany({
    where: { tenantUuid, enabled: true, tenant: { type: TenantType.SUB, status: TenantStatus.ACTIVE, deletedAt: null } },
    select: publicSocialLinkSelect, orderBy,
  });
}
