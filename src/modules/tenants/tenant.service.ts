import {
  MembershipStatus,
  Prisma,
  TenantStatus,
  TenantDomainStatus,
  TenantType,
} from "@prisma/client";
import { prisma } from "@/src/lib/db";
import type { SessionPayload } from "@/src/lib/auth/session";
import { validationError } from "@/src/lib/errors";
import { writeAuthAudit } from "@/src/modules/auth/audit-auth";
import { syncTenantDomains } from "@/src/modules/tenants/tenant-domain.service";
import {
  setLocalDevelopmentAssignment,
} from "@/src/modules/tenants/local-development-tenant.service";
import {
  createSubTenantSchema,
  updateSubTenantSchema,
} from "@/src/modules/tenants/tenant-input-validation";
import { getMainTenant } from "@/src/modules/users/account";
import { mapTenant } from "@/src/modules/tenants/tenant.mapper";
import { requireSuperAdmin } from "@/src/modules/tenants/tenant-console-access.service";

export async function createSubTenant(
  session: SessionPayload,
  input: {
    name: string;
    slug: string;
    managementDomain?: string | null;
    websiteDomain?: string | null;
  },
) {
  await requireSuperAdmin(session);
  const parsed = createSubTenantSchema.safeParse(input);
  if (!parsed.success) {
    throw validationError(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const mainTenant = await getMainTenant();

  const existing = await prisma.tenant.findUnique({
    where: { slug: parsed.data.slug },
  });
  if (existing) {
    throw validationError("Slug already exists");
  }

  try {
    const tenant = await prisma.$transaction(async (tx) => {
      const created = await tx.tenant.create({
        data: {
          type: TenantType.SUB,
          parentTenantUuid: mainTenant.uuid,
          name: parsed.data.name,
          slug: parsed.data.slug,
          status: TenantStatus.ACTIVE,
        },
      });
      await syncTenantDomains(tx, {
        tenantUuid: created.uuid,
        managementDomain: parsed.data.managementDomain ?? null,
        websiteDomain: parsed.data.websiteDomain ?? null,
      });
      const domains = await tx.tenantDomain.findMany({
        where: { tenantUuid: created.uuid },
        select: { purpose: true, hostname: true, status: true, verifiedAt: true },
      });
      await writeAuthAudit(
        {
          action: "SUB_TENANT_CREATED",
          actorUserUuid: session.userId,
          tenantUuid: session.tenantId,
          targetType: "tenant",
          targetUuid: created.uuid,
          metadata: {
            slug: created.slug,
            name: created.name,
            managementDomain: parsed.data.managementDomain ?? null,
            websiteDomain: parsed.data.websiteDomain ?? null,
          },
        },
        tx,
      );
      return { tenant: created, domains };
    });
    return mapTenant({
      ...tenant.tenant,
      domains: tenant.domains,
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw validationError("Tenant slug or domain is already in use");
    }
    throw error;
  }
}

export async function getSubTenant(session: SessionPayload, tenantId: string) {
  await requireSuperAdmin(session);
  const tenant = await prisma.tenant.findFirst({
    where: { uuid: tenantId, type: TenantType.SUB, deletedAt: null },
    select: {
      uuid: true,
      name: true,
      slug: true,
      type: true,
      status: true,
      createdAt: true,
      domains: {
        select: { purpose: true, hostname: true, status: true, verifiedAt: true },
      },
      localDevelopmentAssignment: { select: { hostname: true } },
      _count: {
        select: {
          memberships: {
            where: {
              status: MembershipStatus.ACTIVE,
              user: { deletedAt: null },
            },
          },
        },
      },
    },
  });
  if (!tenant) throw validationError("Sub-tenant not found");
  return mapTenant(tenant);
}

export async function updateSubTenant(
  session: SessionPayload,
  tenantId: string,
  input: {
    name: string;
    slug: string;
    managementDomain?: string | null;
    websiteDomain?: string | null;
    localDevelopmentHostname?: string | null;
  },
) {
  await requireSuperAdmin(session);
  const parsed = updateSubTenantSchema.safeParse(input);
  if (!parsed.success) {
    throw validationError(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const current = await prisma.tenant.findFirst({
    where: { uuid: tenantId, type: TenantType.SUB, deletedAt: null },
    select: {
      uuid: true,
      name: true,
      slug: true,
      domains: {
        select: { purpose: true, hostname: true, status: true, verifiedAt: true },
      },
      localDevelopmentAssignment: { select: { hostname: true } },
    },
  });
  if (!current) throw validationError("Sub-tenant not found");

  const managementDomain =
    parsed.data.managementDomain ??
    (parsed.data.managementDomain === null
      ? null
      : current.domains.find(
          (domain) => domain.purpose === "MANAGEMENT" && domain.status !== TenantDomainStatus.DISABLED,
        )?.hostname ?? null);
  const websiteDomain =
    parsed.data.websiteDomain ??
    (parsed.data.websiteDomain === null
      ? null
      : current.domains.find(
          (domain) => domain.purpose === "WEBSITE" && domain.status !== TenantDomainStatus.DISABLED,
        )?.hostname ?? null);
  const localDevelopmentHostname =
    parsed.data.localDevelopmentHostname ??
    (parsed.data.localDevelopmentHostname === null
      ? null
      : current.localDevelopmentAssignment?.hostname ?? null);

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.update({
        where: { uuid: current.uuid },
        data: {
          name: parsed.data.name,
          slug: parsed.data.slug,
        },
      });
      await syncTenantDomains(tx, {
        tenantUuid: current.uuid,
        managementDomain,
        websiteDomain,
      });
      await setLocalDevelopmentAssignment(
        tx,
        current.uuid,
        localDevelopmentHostname,
      );
      const domains = await tx.tenantDomain.findMany({
        where: { tenantUuid: current.uuid },
        select: { purpose: true, hostname: true, status: true, verifiedAt: true },
      });
      const localDevelopmentAssignment = await tx.localDevelopmentTenant.findUnique({
        where: { tenantUuid: current.uuid },
        select: { hostname: true },
      });
      await writeAuthAudit(
        {
          action: "SUB_TENANT_UPDATED",
          actorUserUuid: session.userId,
          tenantUuid: session.tenantId,
          targetType: "tenant",
          targetUuid: tenant.uuid,
          metadata: {
            name: tenant.name,
            slug: tenant.slug,
            managementDomain,
            websiteDomain,
            localDevelopmentHostname,
          },
        },
        tx,
      );
      return { tenant, domains, localDevelopmentAssignment };
    });
    return mapTenant({
      ...updated.tenant,
      domains: updated.domains,
      localDevelopmentAssignment: updated.localDevelopmentAssignment,
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw validationError("Tenant slug or domain is already in use");
    }
    throw error;
  }
}

export async function setSubTenantStatus(
  session: SessionPayload,
  input: { tenantId: string; status: TenantStatus },
) {
  await requireSuperAdmin(session);

  const tenant = await prisma.tenant.findUnique({
    where: { uuid: input.tenantId },
  });
  if (!tenant || tenant.type !== TenantType.SUB) {
    throw validationError("Sub-tenant not found");
  }

  const updated = await prisma.tenant.update({
    where: { uuid: tenant.uuid },
    data: { status: input.status },
    include: {
      domains: { select: { purpose: true, hostname: true, status: true, verifiedAt: true } },
    },
  });

  await writeAuthAudit({
    action:
      input.status === TenantStatus.SUSPENDED
        ? "SUB_TENANT_SUSPENDED"
        : "SUB_TENANT_REACTIVATED",
    actorUserUuid: session.userId,
    tenantUuid: session.tenantId,
    targetType: "tenant",
    targetUuid: tenant.uuid,
    metadata: { status: input.status },
  });

  return mapTenant(updated);
}

export async function listSubTenants(
  session: SessionPayload,
  input?: { search?: string; page?: number; pageSize?: number },
) {
  await requireSuperAdmin(session);
  const page = Math.max(1, input?.page ?? 1);
  const pageSize = Math.min(50, Math.max(1, input?.pageSize ?? 10));
  const search = input?.search?.trim();

  const where: Prisma.TenantWhereInput = {
    type: TenantType.SUB,
    deletedAt: null,
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" as const } },
            { slug: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.tenant.findMany({
      where,
      select: {
        uuid: true,
        name: true,
        slug: true,
        type: true,
        status: true,
        createdAt: true,
        domains: {
          select: { purpose: true, hostname: true, status: true, verifiedAt: true },
        },
        localDevelopmentAssignment: { select: { hostname: true } },
        _count: {
          select: {
            memberships: {
              where: {
                status: MembershipStatus.ACTIVE,
                user: { deletedAt: null },
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.tenant.count({ where }),
  ]);

  return {
    items: items.map(mapTenant),
    total,
    page,
    pageSize,
  };
}
