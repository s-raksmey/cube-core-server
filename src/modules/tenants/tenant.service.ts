import {
  MembershipStatus,
  Prisma,
  TenantStatus,
  TenantDomainStatus,
  TenantDomainPurpose,
  TenantType,
  UserStatus,
} from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/src/lib/db";
import type { SessionPayload } from "@/src/lib/auth/session";
import { forbidden, validationError } from "@/src/lib/errors";
import {
  createActivationToken,
  getExistingActivationLink,
} from "@/src/modules/auth/activation.service";
import { generateSubTenantUserPasswordResetLink } from "@/src/modules/auth/password-reset.service";
import { writeAuthAudit } from "@/src/modules/auth/audit-auth";
import {
  findActiveTenantByHostname,
  findActiveTenantById,
  findActiveTenantBySlug,
  createDomainVerificationToken,
  domainVerificationRecordName,
  hasDomainVerificationRecord,
  normalizeTenantHostname,
  syncTenantDomains,
} from "@/src/modules/tenants/tenant-domain.service";
import {
  LOCAL_DEVELOPMENT_HOSTNAME,
  setLocalDevelopmentAssignment,
} from "@/src/modules/tenants/local-development-tenant.service";
import {
  displayFullName,
  getMainTenant,
  getRoleUuid,
  mapAuthUser,
  findAccountByUuid,
} from "@/src/modules/users/account";
import { requireTenantUserPermission, type TenantUserPermission } from "@/src/modules/roles/role-permission.service";

function optionalHostname() {
  return z.preprocess(
    (value) => (typeof value === "string" && !value.trim() ? null : value),
    z
      .string()
      .trim()
      .transform((value, ctx) => {
        const normalized = normalizeTenantHostname(value);
        if (!normalized) {
          ctx.addIssue({
            code: "custom",
            message: "Enter a valid hostname without a protocol, port, or path",
          });
          return z.NEVER;
        }
        return normalized;
      })
      .nullable()
      .optional(),
  );
}

const tenantDomainsSchema = {
  managementDomain: optionalHostname(),
  websiteDomain: optionalHostname(),
};

const localDevelopmentHostnameSchema = z.preprocess(
  (value) => (typeof value === "string" && !value.trim() ? null : value),
  z
    .string()
    .trim()
    .transform((value, ctx) => {
      if (value !== LOCAL_DEVELOPMENT_HOSTNAME) {
        ctx.addIssue({
          code: "custom",
          message: "Local development hostname must be localhost or empty",
        });
        return z.NEVER;
      }
      return value;
    })
    .nullable()
    .optional(),
);

function rejectDuplicateDomains<T extends {
  managementDomain?: string | null;
  websiteDomain?: string | null;
}>(schema: z.ZodType<T>) {
  return schema.superRefine((value, ctx) => {
    for (const field of ["managementDomain", "websiteDomain"] as const) {
      const hostname = value[field];
      if (hostname === "localhost" || hostname?.endsWith(".localhost")) {
        ctx.addIssue({
          code: "custom",
          path: [field],
          message:
            "Localhost is shared by all local tenants and cannot be configured as a custom domain",
        });
      }
    }
    if (
      value.managementDomain &&
      value.managementDomain === value.websiteDomain
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["websiteDomain"],
        message: "Management and public domains must be different",
      });
    }
    const sharedTenantAppUrl = process.env.TENANT_APP_URL;
    if (value.managementDomain && sharedTenantAppUrl) {
      try {
        const sharedHostname = normalizeTenantHostname(
          new URL(sharedTenantAppUrl).hostname,
        );
        if (sharedHostname === value.managementDomain) {
          ctx.addIssue({
            code: "custom",
            path: ["managementDomain"],
            message: "The shared tenant app hostname cannot be assigned to one tenant",
          });
        }
      } catch {
        // Invalid deployment configuration does not weaken input validation.
      }
    }
  });
}

const createSubTenantSchema = rejectDuplicateDomains(z.object({
  name: z.string().trim().min(2).max(80),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must be lowercase kebab-case"),
  ...tenantDomainsSchema,
}));

const updateSubTenantSchema = rejectDuplicateDomains(z.object({
  name: z.string().trim().min(2).max(80),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must be lowercase kebab-case"),
  ...tenantDomainsSchema,
  localDevelopmentHostname: localDevelopmentHostnameSchema,
}));

const namePart = z.string().trim().min(1).max(60);
const createTenantUserSchema = z.object({
  email: z.string().trim().email().max(254),
  firstName: namePart,
  lastName: namePart,
  role: z.enum(["ADMIN", "EDITOR"]).default("ADMIN"),
  tenantId: z.string().uuid().optional(),
});

function mapTenant(tenant: {
  uuid: string;
  name: string;
  slug: string;
  type: TenantType;
  status: TenantStatus;
  createdAt: Date;
  domains?: {
    purpose: "MANAGEMENT" | "WEBSITE";
    hostname: string | null;
    status: TenantDomainStatus;
    verifiedAt?: Date | null;
  }[];
  localDevelopmentAssignment?: { hostname: string } | null;
  _count?: { memberships: number };
}) {
  return {
    id: tenant.uuid,
    uuid: tenant.uuid,
    name: tenant.name,
    slug: tenant.slug,
    type: tenant.type,
    status: tenant.status,
    createdAt: tenant.createdAt.toISOString(),
    managementDomain:
      tenant.domains?.find((domain) => domain.purpose === "MANAGEMENT")
        ?.hostname ?? null,
    websiteDomain:
      tenant.domains?.find((domain) => domain.purpose === "WEBSITE")?.hostname ??
      null,
    managementDomainStatus:
      tenant.domains === undefined
        ? null
        : tenant.domains.find((domain) => domain.purpose === "MANAGEMENT")?.status ?? TenantDomainStatus.DISABLED,
    websiteDomainStatus:
      tenant.domains === undefined
        ? null
        : tenant.domains.find((domain) => domain.purpose === "WEBSITE")?.status ?? TenantDomainStatus.DISABLED,
    managementDomainVerifiedAt:
      tenant.domains?.find((domain) => domain.purpose === "MANAGEMENT")?.verifiedAt?.toISOString() ?? null,
    websiteDomainVerifiedAt:
      tenant.domains?.find((domain) => domain.purpose === "WEBSITE")?.verifiedAt?.toISOString() ?? null,
    localDevelopmentHostname: tenant.localDevelopmentAssignment?.hostname ?? null,
    userCount: tenant._count?.memberships ?? 0,
  };
}

async function requireSuperAdmin(session: SessionPayload) {
  if (session.role !== "SUPERADMIN") {
    throw forbidden("SuperAdmin only");
  }
}

async function requireMainSuperAdmin(session: SessionPayload) {
  await requireSuperAdmin(session);
  const mainTenant = await getMainTenant();
  if (session.tenantId !== mainTenant.uuid) {
    throw forbidden("SuperAdmin must use the Main Tenant session");
  }
}

async function requireTenantAdmin(session: SessionPayload) {
  if (session.role !== "ADMIN" && session.role !== "SUPERADMIN") {
    throw forbidden("Admin only");
  }
}

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

export async function resolveSubTenantByHostname(
  hostname: string,
  purpose: TenantDomainPurpose,
) {
  const tenant = await findActiveTenantByHostname(hostname, purpose);
  if (!tenant) return null;
  const managementDomain =
    tenant.domains.find((domain) => domain.purpose === "MANAGEMENT" && domain.status === TenantDomainStatus.ACTIVE)?.hostname ?? null;
  const websiteDomain =
    tenant.domains.find((domain) => domain.purpose === "WEBSITE" && domain.status === TenantDomainStatus.ACTIVE)?.hostname ?? null;
  return {
    id: tenant.uuid,
    name: tenant.name,
    slug: tenant.slug,
    type: tenant.type,
    status: tenant.status,
    managementDomain,
    websiteDomain,
  };
}

export async function resolveSubTenantBySlug(slug: string) {
  const tenant = await findActiveTenantBySlug(slug);
  if (!tenant || tenant.type !== TenantType.SUB) return null;
  return { id: tenant.uuid, name: tenant.name, slug: tenant.slug };
}

export async function resolveSubTenantById(id: string) {
  const tenant = await findActiveTenantById(id);
  if (!tenant || tenant.type !== TenantType.SUB) return null;
  return { id: tenant.uuid, name: tenant.name, slug: tenant.slug };
}

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

/**
 * SuperAdmin: create sub-tenant user (PENDING + activation).
 * Tenant Admin: omit tenantId — uses session tenant.
 */
export async function createAdminUser(
  session: SessionPayload,
  input: {
    email: string;
    firstName: string;
    lastName: string;
    role?: "ADMIN" | "EDITOR";
    tenantId?: string;
  },
) {
  const parsed = createTenantUserSchema.safeParse({
    email: input.email,
    firstName: input.firstName,
    lastName: input.lastName,
    role: input.role ?? "ADMIN",
    tenantId: input.tenantId,
  });
  if (!parsed.success) {
    throw validationError(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  let tenantUuid: string;
  if (session.role === "SUPERADMIN") {
    if (!parsed.data.tenantId) {
      throw validationError("tenantId is required");
    }
    await requireTenantUserPermission(session, "USERS_CREATE");
    if (parsed.data.role !== "EDITOR") {
      await requireTenantUserPermission(session, "USERS_CHANGE_ROLE");
    }
    tenantUuid = parsed.data.tenantId;
  } else {
    await requireTenantUserPermission(session, "USERS_CREATE");
    if (parsed.data.role !== "EDITOR") {
      await requireTenantUserPermission(session, "USERS_CHANGE_ROLE");
    }
    tenantUuid = session.tenantId;
  }

  const tenant = await prisma.tenant.findUnique({
    where: { uuid: tenantUuid },
  });
  if (!tenant || tenant.type !== TenantType.SUB) {
    throw validationError("Sub-tenant users must be created under a sub-tenant");
  }

  const roleCode = parsed.data.role;
  const roleUuid = await getRoleUuid(roleCode);
  const email = parsed.data.email.toLowerCase();

  const exists = await prisma.user.findUnique({ where: { email } });
  if (exists) throw validationError("Email already in use");

  const { user, activation } = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        email,
        firstName: parsed.data.firstName,
        lastName: parsed.data.lastName,
        status: UserStatus.PENDING,
        createdByUuid: session.userId,
      },
    });
    await tx.tenantMembership.create({
      data: {
        userUuid: created.uuid,
        tenantUuid: tenant.uuid,
        roleUuid,
        status: MembershipStatus.ACTIVE,
        createdByUuid: session.userId,
      },
    });
    const activationLink = await createActivationToken(
      {
        userUuid: created.uuid,
        createdByUuid: session.userId,
        tenantUuid: tenant.uuid,
        audience: "TENANT_APP",
      },
      tx,
    );
    await writeAuthAudit(
      {
        action: roleCode === "EDITOR" ? "EDITOR_CREATED" : "ADMIN_CREATED",
        actorUserUuid: session.userId,
        tenantUuid: session.tenantId,
        targetType: "user",
        targetUuid: created.uuid,
        metadata: {
          email: created.email,
          role: roleCode,
          tenantUuid: tenant.uuid,
        },
      },
      tx,
    );
    return { user: created, activation: activationLink };
  });

  const account = await findAccountByUuid(user.uuid, tenant.uuid);
  if (!account) throw validationError("Failed to load created user");

  return {
    user: {
      ...mapAuthUser(account),
      createdAt: user.createdAt.toISOString(),
      lastLoginAt: null,
      totpEnabled: false,
    },
    activationUrl: activation.activationUrl,
    expiresAt: activation.expiresAt,
  };
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

export async function listTenantUsers(
  session: SessionPayload,
  input?: { search?: string; page?: number; pageSize?: number },
) {
  await requireTenantUserPermission(session, "USERS_VIEW");

  const page = Math.max(1, input?.page ?? 1);
  const pageSize = Math.min(50, Math.max(1, input?.pageSize ?? 10));
  const search = input?.search?.trim();

  const where: Prisma.TenantMembershipWhereInput = {
    tenantUuid: session.tenantId,
    status: { in: [MembershipStatus.ACTIVE, MembershipStatus.DISABLED] },
    role: { code: { in: ["ADMIN", "EDITOR"] } },
    user: {
      deletedAt: null,
      ...(search
        ? {
            OR: [
              { firstName: { contains: search, mode: "insensitive" } },
              { lastName: { contains: search, mode: "insensitive" } },
              { email: { contains: search, mode: "insensitive" } },
              { username: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    },
  };

  const [rows, total] = await Promise.all([
    prisma.tenantMembership.findMany({
      where,
      select: {
        status: true,
        user: {
          select: {
            uuid: true,
            email: true,
            username: true,
            firstName: true,
            lastName: true,
            status: true,
            createdAt: true,
            lastLoginAt: true,
            twoFactorAuth: { select: { enabledAt: true } },
          },
        },
        role: { select: { code: true } },
        tenant: {
          select: {
            uuid: true,
            name: true,
            slug: true,
            type: true,
            status: true,
            createdAt: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.tenantMembership.count({ where }),
  ]);

  return {
    items: rows.map((row) => ({
      id: row.user.uuid,
      uuid: row.user.uuid,
      email: row.user.email,
      username: row.user.username,
      firstName: row.user.firstName,
      lastName: row.user.lastName,
      fullName: displayFullName(row.user),
      type: "SUB" as const,
      role: row.role.code,
      status: row.user.status,
      membershipStatus: row.status,
      tenantId: row.tenant.uuid,
      tenant: mapTenant(row.tenant),
      createdAt: row.user.createdAt.toISOString(),
      lastLoginAt: row.user.lastLoginAt?.toISOString() ?? null,
      totpEnabled: Boolean(row.user.twoFactorAuth?.enabledAt),
    })),
    total,
    page,
    pageSize,
  };
}

const managedTenantUsersInputSchema = z.object({
  tenantId: z.string().uuid(),
  search: z.string().trim().max(100).nullish(),
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).max(50).optional(),
});

function deriveActivationStatus(
  user: {
    status: UserStatus;
    activatedAt: Date | null;
    activationTokens: {
      createdAt: Date;
      expiresAt: Date;
      usedAt: Date | null;
      revokedAt: Date | null;
    }[];
  },
  now: Date,
) {
  if (user.status === UserStatus.INACTIVE) return "DISABLED" as const;
  if (user.activatedAt) return "ACTIVE" as const;
  const latest = user.activationTokens[0];
  if (
    latest &&
    !latest.usedAt &&
    !latest.revokedAt &&
    latest.expiresAt <= now
  ) {
    return "EXPIRED" as const;
  }
  return "PENDING" as const;
}

/** Main Console view of a single sub-tenant's users. */
export async function listManagedSubTenantUsers(
  session: SessionPayload,
  input: { tenantId: string; search?: string | null; page?: number; pageSize?: number },
) {
  await requireMainSuperAdmin(session);
  await requireTenantUserPermission(session, "USERS_VIEW");
  const parsed = managedTenantUsersInputSchema.safeParse(input);
  if (!parsed.success) {
    throw validationError(parsed.error.issues[0]?.message ?? "Invalid input");
  }
  const tenant = await prisma.tenant.findFirst({
    where: { uuid: parsed.data.tenantId, type: TenantType.SUB, deletedAt: null },
    select: { uuid: true },
  });
  if (!tenant) throw validationError("Sub-tenant not found");

  const page = parsed.data.page ?? 1;
  const pageSize = parsed.data.pageSize ?? 10;
  const search = parsed.data.search;
  const where: Prisma.TenantMembershipWhereInput = {
    tenantUuid: tenant.uuid,
    status: { in: [MembershipStatus.ACTIVE, MembershipStatus.DISABLED] },
    role: { code: { in: ["ADMIN", "EDITOR"] } },
    user: {
      deletedAt: null,
      ...(search
        ? {
            OR: [
              { firstName: { contains: search, mode: "insensitive" } },
              { lastName: { contains: search, mode: "insensitive" } },
              { email: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    },
  };
  const [rows, total] = await Promise.all([
    prisma.tenantMembership.findMany({
      where,
      select: {
        status: true,
        role: { select: { code: true } },
        user: {
          select: {
            uuid: true,
            email: true,
            firstName: true,
            lastName: true,
            username: true,
            status: true,
            activatedAt: true,
            activationTokens: {
              orderBy: { createdAt: "desc" },
              take: 1,
              select: {
                createdAt: true,
                expiresAt: true,
                usedAt: true,
                revokedAt: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.tenantMembership.count({ where }),
  ]);
  const now = new Date();
  return {
    items: rows.map(({ user, role, status }) => ({
      id: user.uuid,
      fullName: displayFullName(user),
      firstName: user.firstName,
      lastName: user.lastName,
      username: user.username,
      email: user.email,
      role: role.code,
      accountStatus: user.status,
      membershipStatus: status,
      activationStatus: deriveActivationStatus(user, now),
      activationLinkCreatedAt: user.activationTokens[0]?.createdAt.toISOString() ?? null,
      activationLinkExpiresAt: user.activationTokens[0]?.expiresAt.toISOString() ?? null,
    })),
    total,
    page,
    pageSize,
  };
}

/** Return a currently valid tenant activation URL only to an authorized Main SuperAdmin. */
export async function getSubTenantUserActivationLink(
  session: SessionPayload,
  tenantId: string,
  userId: string,
) {
  if (session.role === "SUPERADMIN") {
    await requireMainSuperAdmin(session);
    await requireTenantUserPermission(session, "USERS_ACTIVATE");
  } else {
    if (session.audience !== "TENANT_APP" || session.tenantId !== tenantId) {
      throw forbidden("You can only view activation links for users in your own tenant");
    }
    await requireTenantUserPermission(session, "USERS_ACTIVATE");
  }
  const parsed = z.object({ tenantId: z.string().uuid(), userId: z.string().uuid() })
    .safeParse({ tenantId, userId });
  if (!parsed.success) {
    throw validationError(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const membership = await prisma.tenantMembership.findFirst({
    where: {
      tenantUuid: parsed.data.tenantId,
      userUuid: parsed.data.userId,
      status: MembershipStatus.ACTIVE,
      role: { code: { in: ["ADMIN", "EDITOR"] } },
      tenant: { type: TenantType.SUB, deletedAt: null },
      user: { deletedAt: null, status: UserStatus.PENDING, activatedAt: null },
    },
    select: { userUuid: true },
  });
  if (!membership) throw validationError("Pending user not found in this sub-tenant");

  const link = await getExistingActivationLink(membership.userUuid, {
    audience: "TENANT_APP",
    tenantUuid: parsed.data.tenantId,
  });
  if (!link) return null;

  await writeAuthAudit({
    action: "auth.activation.link_viewed",
    actorUserUuid: session.userId,
    tenantUuid: parsed.data.tenantId,
    targetType: "user",
    targetUuid: membership.userUuid,
    metadata: { audience: "TENANT_APP" },
  });
  return link;
}

/** Return the current valid activation link for a tenant Admin's managed user. */
export async function getTenantUserActivationLink(
  session: SessionPayload,
  userId: string,
) {
  await requireTenantAdminTarget(session, userId, "USERS_ACTIVATE");
  return getSubTenantUserActivationLink(session, session.tenantId, userId);
}

/** Regenerate a pending sub-tenant user's link; the row lock serializes concurrent requests. */
export async function regenerateSubTenantUserActivationLink(
  session: SessionPayload,
  tenantId: string,
  userId: string,
) {
  const parsed = z.object({ tenantId: z.string().uuid(), userId: z.string().uuid() })
    .safeParse({ tenantId, userId });
  if (!parsed.success) {
    throw validationError(parsed.error.issues[0]?.message ?? "Invalid input");
  }
  if (session.role === "SUPERADMIN") {
    await requireMainSuperAdmin(session);
    await requireTenantUserPermission(session, "USERS_ACTIVATE");
  } else {
    if (
      session.audience !== "TENANT_APP" ||
      parsed.data.tenantId !== session.tenantId
    ) {
      throw forbidden("You can only manage users in your own tenant");
    }
    await requireTenantUserPermission(session, "USERS_ACTIVATE");
  }

  const activation = await prisma.$transaction(async (tx) => {
    // Serializes re-issues for this account so only the final link remains valid.
    await tx.$queryRaw<Array<{ uuid: string }>>(
      Prisma.sql`SELECT uuid FROM users WHERE uuid = ${parsed.data.userId} FOR UPDATE`,
    );
    const membership = await tx.tenantMembership.findFirst({
      where: {
        tenantUuid: parsed.data.tenantId,
        userUuid: parsed.data.userId,
        status: MembershipStatus.ACTIVE,
        role: { code: { in: ["ADMIN", "EDITOR"] } },
        tenant: { type: TenantType.SUB, deletedAt: null },
        user: { deletedAt: null },
      },
      select: {
        user: { select: { uuid: true, status: true, activatedAt: true } },
      },
    });
    if (!membership) throw validationError("User not found in this sub-tenant");
    if (membership.user.status !== UserStatus.PENDING && membership.user.status !== UserStatus.ACTIVE) {
      throw validationError(
        "Activation links can only be generated for pending or active accounts.",
      );
    }

    const now = new Date();
    if (membership.user.status === UserStatus.ACTIVE) {
      await tx.user.update({ where: { uuid: membership.user.uuid }, data: { username: null, passwordHash: null, status: UserStatus.PENDING, activatedAt: null, failedPasswordAttempts: 0, failedTotpAttempts: 0, lockedUntil: null, sessionsRevokedAt: now } });
      await tx.userTwoFactorAuth.updateMany({ where: { userUuid: membership.user.uuid }, data: { encryptedSecret: null, pendingEncryptedSecret: null, pendingExpiresAt: null, enabledAt: null } });
      await tx.authLoginChallenge.updateMany({ where: { userUuid: membership.user.uuid, consumedAt: null }, data: { consumedAt: now } });
      await tx.userRecoveryCode.deleteMany({ where: { userUuid: membership.user.uuid } });
      await tx.userPasswordResetToken.updateMany({ where: { userUuid: membership.user.uuid, usedAt: null, revokedAt: null }, data: { revokedAt: now } });
      await tx.userSession.updateMany({ where: { userUuid: membership.user.uuid, tenantUuid: parsed.data.tenantId, revokedAt: null }, data: { revokedAt: now } });
    }

    const link = await createActivationToken(
      {
        userUuid: membership.user.uuid,
        createdByUuid: session.userId,
        tenantUuid: parsed.data.tenantId,
        audience: "TENANT_APP",
      },
      tx,
    );
    await writeAuthAudit(
      {
        action: membership.user.status === UserStatus.ACTIVE ? "auth.account.reactivated" : "auth.activation.link_regenerated",
        actorUserUuid: session.userId,
        tenantUuid: parsed.data.tenantId,
        targetType: "user",
        targetUuid: membership.user.uuid,
        metadata: { audience: "TENANT_APP" },
      },
      tx,
    );
    return link;
  });

  const account = await findAccountByUuid(userId, tenantId);
  if (!account) throw validationError("User not found");
  return {
    ...activation,
    user: {
      ...mapAuthUser(account),
      createdAt: null,
      lastLoginAt: null,
      totpEnabled: false,
    },
  };
}

export async function generateTenantUserActivationLink(session: SessionPayload, userId: string) {
  await requireTenantAdminTarget(session, userId, "USERS_ACTIVATE");
  return regenerateSubTenantUserActivationLink(session, session.tenantId, userId);
}

const tenantUserUpdateSchema = z.object({
  email: z.string().trim().email().max(254).optional(),
  firstName: z.string().trim().min(1).max(60).optional(),
  lastName: z.string().trim().min(1).max(60).optional(),
  role: z.enum(["ADMIN", "EDITOR"]).optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
  suspended: z.boolean().optional(),
});

async function requireTenantAdminTarget(
  session: SessionPayload,
  userId: string,
  permission: TenantUserPermission = "USERS_EDIT",
) {
  await requireTenantUserPermission(session, permission);
  const membership = await prisma.tenantMembership.findFirst({
    where: { tenantUuid: session.tenantId, userUuid: userId, status: { in: [MembershipStatus.ACTIVE, MembershipStatus.DISABLED] }, role: { code: { in: ["ADMIN", "EDITOR"] } }, user: { deletedAt: null } },
    select: { uuid: true, userUuid: true, status: true, role: { select: { code: true } }, user: { select: { status: true, email: true } } },
  });
  if (!membership) throw validationError("User not found");
  if (membership.userUuid === session.userId) throw validationError("You cannot change your own tenant access");
  return membership;
}

export async function updateTenantUser(session: SessionPayload, userId: string, input: unknown) {
  const parsed = tenantUserUpdateSchema.safeParse(input);
  if (!parsed.success) throw validationError(parsed.error.issues[0]?.message ?? "Invalid input");
  if (userId === session.userId) {
    await requireTenantUserPermission(session, "USERS_EDIT");
    const ownMembership = await prisma.tenantMembership.findFirst({
      where: {
        tenantUuid: session.tenantId,
        userUuid: session.userId,
        status: MembershipStatus.ACTIVE,
        role: { code: { in: ["ADMIN", "EDITOR"] } },
        tenant: { type: TenantType.SUB },
        user: { deletedAt: null, status: UserStatus.ACTIVE },
      },
      select: { uuid: true },
    });
    if (!ownMembership) throw forbidden("You do not have access to manage this tenant");
    if (parsed.data.role || parsed.data.status) {
      throw validationError("You cannot change your own role or account status");
    }
    if (parsed.data.email) {
      const email = parsed.data.email.toLowerCase();
      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing && existing.uuid !== session.userId) throw validationError("Email already in use");
    }
    await prisma.user.update({ where: { uuid: session.userId }, data: { ...(parsed.data.email ? { email: parsed.data.email.toLowerCase() } : {}), ...(parsed.data.firstName ? { firstName: parsed.data.firstName } : {}), ...(parsed.data.lastName ? { lastName: parsed.data.lastName } : {}) } });
    await writeAuthAudit({ action: "TENANT_USER_UPDATED", actorUserUuid: session.userId, tenantUuid: session.tenantId, targetType: "user", targetUuid: session.userId, metadata: { changed: Object.keys(parsed.data), selfServiceProfile: true } });
    const account = await findAccountByUuid(session.userId, session.tenantId);
    if (!account) throw validationError("User not found");
    return { ...mapAuthUser(account), createdAt: null, lastLoginAt: null, totpEnabled: Boolean(account.totpEnabledAt) };
  }
  const updatePermission: TenantUserPermission = parsed.data.role
    ? "USERS_CHANGE_ROLE"
    : parsed.data.suspended !== undefined || parsed.data.status === "INACTIVE"
      ? "USERS_SUSPEND"
      : "USERS_EDIT";
  const membership = await requireTenantAdminTarget(session, userId, updatePermission);
  if (
    (parsed.data.email || parsed.data.firstName || parsed.data.lastName) &&
    updatePermission !== "USERS_EDIT"
  ) {
    await requireTenantUserPermission(session, "USERS_EDIT");
  }
  if (parsed.data.role && (parsed.data.suspended || parsed.data.status === "INACTIVE")) {
    await requireTenantUserPermission(session, "USERS_SUSPEND");
  }
  if (parsed.data.email && parsed.data.email.toLowerCase() !== membership.user.email) {
    const exists = await prisma.user.findUnique({ where: { email: parsed.data.email.toLowerCase() } });
    if (exists) throw validationError("Email already in use");
  }
  if (membership.role.code === "ADMIN" && (parsed.data.role === "EDITOR" || parsed.data.suspended || parsed.data.status === "INACTIVE")) {
    const activeAdmins = await prisma.tenantMembership.count({ where: { tenantUuid: session.tenantId, status: MembershipStatus.ACTIVE, role: { code: "ADMIN" }, user: { status: UserStatus.ACTIVE, deletedAt: null } } });
    if (membership.user.status === UserStatus.ACTIVE && membership.status === MembershipStatus.ACTIVE && activeAdmins <= 1) throw validationError("Cannot remove the last active tenant Admin");
  }
  await prisma.$transaction(async (tx) => {
    if (parsed.data.role) await tx.tenantMembership.update({ where: { uuid: membership.uuid }, data: { roleUuid: await getRoleUuid(parsed.data.role) } });
    if (parsed.data.suspended !== undefined) await tx.tenantMembership.update({ where: { uuid: membership.uuid }, data: { status: parsed.data.suspended ? MembershipStatus.DISABLED : MembershipStatus.ACTIVE } });
    await tx.user.update({ where: { uuid: userId }, data: { ...(parsed.data.email ? { email: parsed.data.email.toLowerCase() } : {}), ...(parsed.data.firstName ? { firstName: parsed.data.firstName } : {}), ...(parsed.data.lastName ? { lastName: parsed.data.lastName } : {}), ...(parsed.data.status ? { status: parsed.data.status as UserStatus } : {}) } });
    if (parsed.data.suspended || parsed.data.status === "INACTIVE") await tx.userSession.updateMany({ where: { userUuid: userId, tenantUuid: session.tenantId, revokedAt: null }, data: { revokedAt: new Date() } });
  });
  await writeAuthAudit({ action: "TENANT_USER_UPDATED", actorUserUuid: session.userId, tenantUuid: session.tenantId, targetType: "user", targetUuid: userId, metadata: { changed: Object.keys(parsed.data) } });
  const account = await findAccountByUuid(userId, session.tenantId, true);
  if (!account) throw validationError("User not found");
  return { ...mapAuthUser(account), createdAt: null, lastLoginAt: null, totpEnabled: Boolean(account.totpEnabledAt) };
}

export async function generateTenantUserPasswordResetLink(session: SessionPayload, userId: string) {
  await requireTenantAdminTarget(session, userId, "USERS_RESET_PASSWORD");
  return generateSubTenantUserPasswordResetLink(session, userId);
}

/** Delete a suspended user's membership from the current sub-tenant. */
export async function deleteTenantUser(
  session: SessionPayload,
  userId: string,
) {
  await requireTenantUserPermission(session, "USERS_DELETE");

  const membership = await prisma.tenantMembership.findFirst({
    where: {
      tenantUuid: session.tenantId,
      userUuid: userId,
      status: { in: [MembershipStatus.ACTIVE, MembershipStatus.DISABLED] },
      role: { code: { in: ["ADMIN", "EDITOR"] } },
      tenant: { type: TenantType.SUB },
      user: { deletedAt: null },
    },
    select: {
      uuid: true,
      userUuid: true,
      status: true,
      user: { select: { email: true } },
      role: { select: { code: true } },
    },
  });
  if (!membership) throw validationError("User not found");
  if (membership.userUuid === session.userId) {
    throw validationError("You cannot remove your own access");
  }
  if (membership.status !== MembershipStatus.DISABLED) {
    throw validationError("Suspend this tenant user before deleting them");
  }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    // Serialize membership deletion with the active-membership check below.
    await tx.$queryRaw`WITH tenant_roster_lock AS MATERIALIZED (
      SELECT pg_advisory_xact_lock(hashtext(${session.tenantId}), 2)
    )
    SELECT 1 AS locked FROM tenant_roster_lock`;

    const current = await tx.tenantMembership.findFirst({
      where: {
        uuid: membership.uuid,
        tenantUuid: session.tenantId,
        status: MembershipStatus.DISABLED,
        role: { code: { in: ["ADMIN", "EDITOR"] } },
        tenant: { type: TenantType.SUB },
        user: { deletedAt: null },
      },
      select: {
        uuid: true,
        userUuid: true,
        role: { select: { code: true } },
        user: { select: { status: true } },
      },
    });
    if (!current) throw validationError("User not found");

    await tx.tenantMembership.delete({ where: { uuid: current.uuid } });
    await tx.userSession.updateMany({
      where: {
        userUuid: current.userUuid,
        tenantUuid: session.tenantId,
        revokedAt: null,
      },
      data: { revokedAt: now },
    });

    const hasOtherActiveMembership =
      (await tx.tenantMembership.count({
        where: {
          userUuid: current.userUuid,
          status: MembershipStatus.ACTIVE,
        },
      })) > 0;

    if (!hasOtherActiveMembership) {
      await tx.user.update({
        where: { uuid: current.userUuid },
        data: {
          status: UserStatus.INACTIVE,
          deletedAt: now,
          sessionsRevokedAt: now,
        },
      });
      await tx.userSession.updateMany({
        where: { userUuid: current.userUuid, revokedAt: null },
        data: { revokedAt: now },
      });
      await tx.userActivationToken.updateMany({
        where: {
          userUuid: current.userUuid,
          usedAt: null,
          revokedAt: null,
        },
        data: { revokedAt: now, encryptedToken: null },
      });
      await tx.userPasswordResetToken.updateMany({
        where: {
          userUuid: current.userUuid,
          usedAt: null,
          revokedAt: null,
        },
        data: { revokedAt: now },
      });
    }
  });

  await writeAuthAudit({
    action: "TENANT_USER_REMOVED",
    actorUserUuid: session.userId,
    tenantUuid: session.tenantId,
    targetType: "user",
    targetUuid: membership.userUuid,
    metadata: {
      email: membership.user.email,
      role: membership.role.code,
      membershipUuid: membership.uuid,
    },
  });

  return true;
}

async function requireManagedSubTenantUser(
  session: SessionPayload,
  tenantId: string,
  userId: string,
  permission: TenantUserPermission,
) {
  await requireMainSuperAdmin(session);
  await requireTenantUserPermission(session, permission);
  const parsed = z.object({ tenantId: z.string().uuid(), userId: z.string().uuid() })
    .safeParse({ tenantId, userId });
  if (!parsed.success) throw validationError(parsed.error.issues[0]?.message ?? "Invalid input");
  const membership = await prisma.tenantMembership.findFirst({
    where: {
      tenantUuid: parsed.data.tenantId,
      userUuid: parsed.data.userId,
      status: { in: [MembershipStatus.ACTIVE, MembershipStatus.DISABLED] },
      role: { code: { in: ["ADMIN", "EDITOR"] } },
      tenant: { type: TenantType.SUB, status: TenantStatus.ACTIVE, deletedAt: null },
      user: { deletedAt: null },
    },
    select: { uuid: true, userUuid: true, status: true, role: { select: { code: true } }, user: { select: { email: true, status: true } } },
  });
  if (!membership) throw validationError("User not found in this sub-tenant");
  return { ...membership, tenantId: parsed.data.tenantId };
}

export async function updateManagedSubTenantUser(
  session: SessionPayload,
  tenantId: string,
  userId: string,
  input: unknown,
) {
  const parsed = tenantUserUpdateSchema.safeParse(input);
  if (!parsed.success) throw validationError(parsed.error.issues[0]?.message ?? "Invalid input");
  const permission: TenantUserPermission = parsed.data.role
    ? "USERS_CHANGE_ROLE"
    : parsed.data.suspended !== undefined || parsed.data.status === "INACTIVE"
      ? "USERS_SUSPEND"
      : "USERS_EDIT";
  const membership = await requireManagedSubTenantUser(session, tenantId, userId, permission);
  if ((parsed.data.email || parsed.data.firstName || parsed.data.lastName) && permission !== "USERS_EDIT") {
    await requireTenantUserPermission(session, "USERS_EDIT");
  }
  if (parsed.data.role && (parsed.data.suspended || parsed.data.status === "INACTIVE")) {
    await requireTenantUserPermission(session, "USERS_SUSPEND");
  }
  if (parsed.data.email && parsed.data.email.toLowerCase() !== membership.user.email) {
    const exists = await prisma.user.findUnique({ where: { email: parsed.data.email.toLowerCase() }, select: { uuid: true } });
    if (exists) throw validationError("Email already in use");
  }
  if (membership.role.code === "ADMIN" && (parsed.data.role === "EDITOR" || parsed.data.suspended || parsed.data.status === "INACTIVE")) {
    const activeAdmins = await prisma.tenantMembership.count({ where: { tenantUuid: membership.tenantId, status: MembershipStatus.ACTIVE, role: { code: "ADMIN" }, user: { status: UserStatus.ACTIVE, deletedAt: null } } });
    if (membership.status === MembershipStatus.ACTIVE && membership.user.status === UserStatus.ACTIVE && activeAdmins <= 1) {
      throw validationError("Cannot remove the last active tenant Admin");
    }
  }
  await prisma.$transaction(async (tx) => {
    if (parsed.data.role) await tx.tenantMembership.update({ where: { uuid: membership.uuid }, data: { roleUuid: await getRoleUuid(parsed.data.role) } });
    if (parsed.data.suspended !== undefined) await tx.tenantMembership.update({ where: { uuid: membership.uuid }, data: { status: parsed.data.suspended ? MembershipStatus.DISABLED : MembershipStatus.ACTIVE } });
    await tx.user.update({ where: { uuid: membership.userUuid }, data: { ...(parsed.data.email ? { email: parsed.data.email.toLowerCase() } : {}), ...(parsed.data.firstName ? { firstName: parsed.data.firstName } : {}), ...(parsed.data.lastName ? { lastName: parsed.data.lastName } : {}), ...(parsed.data.status ? { status: parsed.data.status as UserStatus } : {}) } });
    if (parsed.data.suspended || parsed.data.status === "INACTIVE") await tx.userSession.updateMany({ where: { userUuid: membership.userUuid, tenantUuid: membership.tenantId, revokedAt: null }, data: { revokedAt: new Date() } });
  });
  await writeAuthAudit({ action: "MANAGED_SUB_TENANT_USER_UPDATED", actorUserUuid: session.userId, tenantUuid: membership.tenantId, targetType: "user", targetUuid: membership.userUuid, metadata: { changed: Object.keys(parsed.data) } });
  const account = await findAccountByUuid(membership.userUuid, membership.tenantId, true);
  if (!account) throw validationError("User not found");
  return { ...mapAuthUser(account), createdAt: null, lastLoginAt: null, totpEnabled: Boolean(account.totpEnabledAt) };
}

export async function generateManagedSubTenantUserPasswordResetLink(session: SessionPayload, tenantId: string, userId: string) {
  const membership = await requireManagedSubTenantUser(session, tenantId, userId, "USERS_RESET_PASSWORD");
  return generateSubTenantUserPasswordResetLink(session, membership.userUuid);
}

export async function deleteManagedSubTenantUser(session: SessionPayload, tenantId: string, userId: string) {
  const membership = await requireManagedSubTenantUser(session, tenantId, userId, "USERS_DELETE");
  if (membership.status !== MembershipStatus.DISABLED) {
    throw validationError("Suspend this tenant user before deleting them");
  }
  const now = new Date();
  await prisma.$transaction([
    prisma.tenantMembership.delete({ where: { uuid: membership.uuid } }),
    prisma.userSession.updateMany({ where: { userUuid: membership.userUuid, tenantUuid: membership.tenantId, revokedAt: null }, data: { revokedAt: now } }),
  ]);
  await writeAuthAudit({
    action: "MANAGED_SUB_TENANT_USER_DELETED",
    actorUserUuid: session.userId,
    tenantUuid: membership.tenantId,
    targetType: "user",
    targetUuid: membership.userUuid,
    metadata: { email: membership.user.email, membershipUuid: membership.uuid },
  });
  return true;
}
