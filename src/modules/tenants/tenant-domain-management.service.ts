import {
  TenantDomainPurpose,
  TenantDomainStatus,
  TenantType,
} from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/src/lib/db";
import type { SessionPayload } from "@/src/lib/auth/session";
import { validationError } from "@/src/lib/errors";
import { writeAuthAudit } from "@/src/modules/auth/audit-auth";
import {
  createDomainVerificationToken,
  domainVerificationRecordName,
  hasDomainVerificationRecord,
} from "@/src/modules/tenants/tenant-domain.service";
import { requireMainSuperAdmin } from "@/src/modules/tenants/tenant-console-access.service";
async function findSubTenantDomain(tenantId: string, purpose: TenantDomainPurpose) {
  const tenant = await prisma.tenant.findFirst({
    where: { uuid: tenantId, type: TenantType.SUB, deletedAt: null },
    select: {
      uuid: true,
      domains: {
        where: { purpose },
        select: { uuid: true, purpose: true, hostname: true, status: true, verifiedAt: true, verificationToken: true },
        take: 1,
      },
    },
  });
  const domain = tenant?.domains[0];
  if (!tenant || !domain || !domain.hostname) throw validationError("Tenant domain is not configured");
  return { tenant, domain: { ...domain, hostname: domain.hostname } };
}

export async function startTenantDomainVerification(
  session: SessionPayload,
  tenantId: string,
  purpose: TenantDomainPurpose,
) {
  await requireMainSuperAdmin(session);
  const parsed = z.object({ tenantId: z.string().uuid(), purpose: z.nativeEnum(TenantDomainPurpose) })
    .safeParse({ tenantId, purpose });
  if (!parsed.success) throw validationError("Invalid tenant domain");
  const { tenant, domain } = await findSubTenantDomain(parsed.data.tenantId, parsed.data.purpose);
  if (domain.status === TenantDomainStatus.ACTIVE) throw validationError("This domain is already active");
  const token = createDomainVerificationToken();
  await prisma.$transaction(async (tx) => {
    const transition = await tx.tenantDomain.updateMany({
      where: { uuid: domain.uuid, hostname: domain.hostname, status: { not: TenantDomainStatus.ACTIVE } },
      data: { status: TenantDomainStatus.PENDING_VERIFICATION, verifiedAt: null, verificationToken: token },
    });
    if (transition.count !== 1) throw validationError("Domain configuration changed; open setup again");
    await writeAuthAudit({
      action: "TENANT_DOMAIN_VERIFICATION_STARTED",
      actorUserUuid: session.userId,
      tenantUuid: session.tenantId,
      targetType: "tenant",
      targetUuid: tenant.uuid,
      metadata: { purpose: domain.purpose, hostname: domain.hostname },
    }, tx);
  });
  return {
    purpose: domain.purpose,
    hostname: domain.hostname,
    status: TenantDomainStatus.PENDING_VERIFICATION,
    verifiedAt: null,
    recordName: domainVerificationRecordName(domain.hostname),
    recordValue: `cube-core-verification=${token}`,
  };
}

export async function checkTenantDomainVerification(
  session: SessionPayload,
  tenantId: string,
  purpose: TenantDomainPurpose,
) {
  await requireMainSuperAdmin(session);
  const parsed = z.object({ tenantId: z.string().uuid(), purpose: z.nativeEnum(TenantDomainPurpose) })
    .safeParse({ tenantId, purpose });
  if (!parsed.success) throw validationError("Invalid tenant domain");
  const { tenant, domain } = await findSubTenantDomain(parsed.data.tenantId, parsed.data.purpose);
  if (domain.status === TenantDomainStatus.ACTIVE) {
    return { purpose: domain.purpose, hostname: domain.hostname, status: domain.status, verifiedAt: domain.verifiedAt?.toISOString() ?? null };
  }
  const verified = domain.verificationToken
    ? await hasDomainVerificationRecord(domain.hostname, domain.verificationToken)
    : false;
  if (!verified) {
    return { purpose: domain.purpose, hostname: domain.hostname, status: domain.status, verifiedAt: null };
  }
  const verifiedAt = new Date();
  await prisma.$transaction(async (tx) => {
    const transition = await tx.tenantDomain.updateMany({
      where: {
        uuid: domain.uuid,
        hostname: domain.hostname,
        status: TenantDomainStatus.PENDING_VERIFICATION,
        verificationToken: domain.verificationToken,
      },
      data: { status: TenantDomainStatus.PENDING_DNS, verifiedAt, verificationToken: null },
    });
    if (transition.count !== 1) throw validationError("Domain verification changed while checking DNS; try again");
    await writeAuthAudit({
      action: "TENANT_DOMAIN_VERIFIED",
      actorUserUuid: session.userId,
      tenantUuid: session.tenantId,
      targetType: "tenant",
      targetUuid: tenant.uuid,
      metadata: { purpose: domain.purpose, hostname: domain.hostname },
    }, tx);
  });
  return { purpose: domain.purpose, hostname: domain.hostname, status: TenantDomainStatus.PENDING_DNS, verifiedAt: verifiedAt.toISOString() };
}

/** SuperAdmins confirm the provider's DNS, shared-app routing, and HTTPS setup after testing the custom hostname. */
export async function activateTenantDomain(
  session: SessionPayload,
  tenantId: string,
  purpose: TenantDomainPurpose,
  confirmHttpsAndRouting: boolean,
) {
  await requireMainSuperAdmin(session);
  const parsed = z.object({
    tenantId: z.string().uuid(),
    purpose: z.nativeEnum(TenantDomainPurpose),
    confirmHttpsAndRouting: z.literal(true),
  }).safeParse({ tenantId, purpose, confirmHttpsAndRouting });
  if (!parsed.success) throw validationError("Confirm that DNS routing and HTTPS work before connecting this domain");
  const { tenant, domain } = await findSubTenantDomain(parsed.data.tenantId, parsed.data.purpose);
  if (domain.status !== TenantDomainStatus.PENDING_DNS || !domain.verifiedAt) {
    throw validationError("Verify domain ownership before connecting this domain");
  }
  await prisma.$transaction(async (tx) => {
    const transition = await tx.tenantDomain.updateMany({
      where: { uuid: domain.uuid, hostname: domain.hostname, status: TenantDomainStatus.PENDING_DNS, verifiedAt: domain.verifiedAt },
      data: { status: TenantDomainStatus.ACTIVE },
    });
    if (transition.count !== 1) throw validationError("Domain configuration changed; verify it again before connecting");
    await writeAuthAudit({
      action: "TENANT_DOMAIN_ACTIVATED",
      actorUserUuid: session.userId,
      tenantUuid: session.tenantId,
      targetType: "tenant",
      targetUuid: tenant.uuid,
      metadata: { purpose: domain.purpose, hostname: domain.hostname },
    }, tx);
  });
  return { purpose: domain.purpose, hostname: domain.hostname, status: TenantDomainStatus.ACTIVE, verifiedAt: domain.verifiedAt.toISOString() };
}

