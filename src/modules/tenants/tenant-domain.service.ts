import { isIP } from "node:net";
import { domainToASCII } from "node:url";
import { resolveTxt } from "node:dns/promises";
import { randomBytes } from "node:crypto";
import {
  TenantDomainPurpose,
  TenantDomainStatus,
  TenantStatus,
  TenantType,
  type TenantDomainPurpose as TenantDomainPurposeType,
} from "@prisma/client";
import { prisma } from "@/src/lib/db";
import type { Prisma } from "@prisma/client";

const HOSTNAME_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/;

/** Normalize a DNS hostname; reject URLs, ports, paths, IPs, and invalid labels. */
export function normalizeTenantHostname(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/[\/:@?#\s]/.test(trimmed)) return null;

  const withoutTrailingDot = trimmed.replace(/\.+$/, "");
  const ascii = domainToASCII(withoutTrailingDot).toLowerCase();
  if (
    !ascii ||
    ascii.length > 253 ||
    isIP(ascii) !== 0 ||
    !HOSTNAME_PATTERN.test(ascii)
  ) {
    return null;
  }
  return ascii;
}

export async function syncTenantDomains(
  client: Prisma.TransactionClient,
  input: {
    tenantUuid: string;
    managementDomain: string | null;
    websiteDomain: string | null;
  },
) {
  for (const [purpose, hostname] of [
    [TenantDomainPurpose.MANAGEMENT, input.managementDomain],
    [TenantDomainPurpose.WEBSITE, input.websiteDomain],
  ] as const) {
    const where = { tenantUuid_purpose: { tenantUuid: input.tenantUuid, purpose } };
    const current = await client.tenantDomain.findUnique({ where, select: { uuid: true, hostname: true, status: true } });
    if (hostname === null) {
      await client.tenantDomain.upsert({
        where,
        create: { tenantUuid: input.tenantUuid, purpose, hostname: null, status: TenantDomainStatus.DISABLED },
        update: {
          hostname: null,
          status: TenantDomainStatus.DISABLED,
          verifiedAt: null,
          verificationToken: null,
        },
      });
      continue;
    }
    if (current?.hostname === hostname && current.status !== TenantDomainStatus.DISABLED) continue;
    await client.tenantDomain.upsert({
      where,
      create: {
        tenantUuid: input.tenantUuid,
        purpose,
        hostname,
        status: TenantDomainStatus.PENDING_VERIFICATION,
      },
      update: {
        hostname,
        status: TenantDomainStatus.PENDING_VERIFICATION,
        verifiedAt: null,
        verificationToken: null,
      },
    });
  }
}

export async function findManagementHostname(tenantUuid: string) {
  const mapping = await prisma.tenantDomain.findUnique({
    where: {
      tenantUuid_purpose: {
        tenantUuid,
        purpose: TenantDomainPurpose.MANAGEMENT,
      },
    },
    select: { hostname: true, status: true },
  });
  return mapping?.status === TenantDomainStatus.ACTIVE ? mapping.hostname : null;
}

export function managementAppBaseUrl(hostname: string | null, fallback: string) {
  return process.env.NODE_ENV === "production" && hostname
    ? `https://${hostname}`
    : fallback.replace(/\/$/, "");
}

/** Public hostname lookup only resolves identity; callers must still authorize by session. */
export async function findActiveTenantByHostname(
  hostname: string,
  purpose: TenantDomainPurposeType,
) {
  const normalized = normalizeTenantHostname(hostname);
  if (!normalized) return null;

  const domain = await prisma.tenantDomain.findFirst({
    where: {
      hostname: normalized,
      purpose,
      status: TenantDomainStatus.ACTIVE,
      tenant: {
        type: TenantType.SUB,
        status: TenantStatus.ACTIVE,
        deletedAt: null,
      },
    },
    select: {
      tenant: {
        select: {
          uuid: true,
          name: true,
          slug: true,
          type: true,
          status: true,
          branding: { select: { managementLogoPath: true, websiteLogoPath: true, faviconPath: true, publicWebsiteFaviconPath: true, openGraphImagePath: true } },
          domains: {
            where: { status: TenantDomainStatus.ACTIVE },
            select: { purpose: true, hostname: true, status: true },
          },
        },
      },
    },
  });
  return domain?.tenant ?? null;
}

/** Resolve a local/shared-app selection to public tenant identity; never treat it as authorization. */
export async function findActiveTenantBySlug(slug: string) {
  const normalized = slug.trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalized) || normalized.length > 60) {
    return null;
  }
  return prisma.tenant.findFirst({
    where: {
      slug: normalized,
      type: TenantType.SUB,
      status: TenantStatus.ACTIVE,
      deletedAt: null,
    },
    select: {
      uuid: true,
      name: true,
      slug: true,
      type: true,
      status: true,
      branding: { select: { managementLogoPath: true, websiteLogoPath: true, faviconPath: true, publicWebsiteFaviconPath: true, openGraphImagePath: true } },
    },
  });
}

/** Resolve a public tenant identifier to active SUB identity only. */
export async function findActiveTenantById(id: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return null;
  }
  return prisma.tenant.findFirst({
    where: {
      uuid: id,
      type: TenantType.SUB,
      status: TenantStatus.ACTIVE,
      deletedAt: null,
    },
    select: {
      uuid: true,
      name: true,
      slug: true,
      type: true,
      status: true,
      branding: { select: { managementLogoPath: true, websiteLogoPath: true, faviconPath: true, publicWebsiteFaviconPath: true, openGraphImagePath: true } },
    },
  });
}

export function createDomainVerificationToken() {
  return randomBytes(32).toString("base64url");
}

/** Verify ownership by an exact DNS TXT challenge, not by a caller-supplied assertion. */
export async function hasDomainVerificationRecord(hostname: string, token: string) {
  try {
    const records = await resolveTxt(`_cube-core-verification.${hostname}`);
    const expected = `cube-core-verification=${token}`;
    return records.some((parts) => parts.join("").trim() === expected);
  } catch {
    return false;
  }
}

export function domainVerificationRecordName(hostname: string) {
  return `_cube-core-verification.${hostname}`;
}

