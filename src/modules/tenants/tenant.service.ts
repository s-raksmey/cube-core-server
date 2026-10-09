import {
  Prisma,
  TenantStatus,
  TenantType,
  UserRole,
  UserStatus,
} from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/src/lib/db";
import { hashPassword } from "@/src/lib/auth/password";
import type { SessionPayload } from "@/src/lib/auth/session";
import { forbidden, validationError } from "@/src/lib/errors";

const createSubTenantSchema = z.object({
  name: z.string().trim().min(2).max(80),
  slug: z
    .string()
    .trim()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must be lowercase kebab-case"),
});

const createAdminSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8).max(128),
  tenantId: z.string().uuid(),
});

async function requireSuperAdmin(session: SessionPayload) {
  if (session.role !== UserRole.SUPERADMIN) {
    throw forbidden("SuperAdmin only");
  }
}

async function writeAudit(input: {
  actorUserId: string;
  actorTenantId: string;
  targetTenantId?: string;
  action: string;
  metadata?: Prisma.InputJsonValue;
}) {
  await prisma.auditLog.create({
    data: {
      actorUserId: input.actorUserId,
      actorTenantId: input.actorTenantId,
      targetTenantId: input.targetTenantId,
      action: input.action,
      metadata: input.metadata ?? {},
    },
  });
}

export async function createSubTenant(
  session: SessionPayload,
  input: { name: string; slug: string },
) {
  await requireSuperAdmin(session);
  const parsed = createSubTenantSchema.safeParse(input);
  if (!parsed.success) {
    throw validationError(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const mainTenant = await prisma.tenant.findFirst({
    where: { type: TenantType.MAIN },
  });
  if (!mainTenant) {
    throw validationError("Main tenant is missing");
  }

  const existing = await prisma.tenant.findUnique({
    where: { slug: parsed.data.slug },
  });
  if (existing) {
    throw validationError("Slug already exists");
  }

  const tenant = await prisma.tenant.create({
    data: {
      type: TenantType.SUB,
      parentTenantId: mainTenant.id,
      name: parsed.data.name,
      slug: parsed.data.slug,
      status: TenantStatus.ACTIVE,
    },
  });

  await writeAudit({
    actorUserId: session.userId,
    actorTenantId: session.tenantId,
    targetTenantId: tenant.id,
    action: "SUB_TENANT_CREATED",
    metadata: { slug: tenant.slug, name: tenant.name },
  });

  return tenant;
}

export async function setSubTenantStatus(
  session: SessionPayload,
  input: { tenantId: string; status: TenantStatus },
) {
  await requireSuperAdmin(session);

  const tenant = await prisma.tenant.findUnique({
    where: { id: input.tenantId },
  });
  if (!tenant || tenant.type !== TenantType.SUB) {
    throw validationError("Sub-tenant not found");
  }

  const updated = await prisma.tenant.update({
    where: { id: tenant.id },
    data: { status: input.status },
  });

  await writeAudit({
    actorUserId: session.userId,
    actorTenantId: session.tenantId,
    targetTenantId: tenant.id,
    action:
      input.status === TenantStatus.SUSPENDED
        ? "SUB_TENANT_SUSPENDED"
        : "SUB_TENANT_REACTIVATED",
    metadata: { status: input.status },
  });

  return updated;
}

export async function createAdminUser(
  session: SessionPayload,
  input: { email: string; password: string; tenantId: string },
) {
  await requireSuperAdmin(session);
  const parsed = createAdminSchema.safeParse(input);
  if (!parsed.success) {
    throw validationError(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: parsed.data.tenantId },
  });
  if (!tenant || tenant.type !== TenantType.SUB) {
    throw validationError("Admin must be created under a sub-tenant");
  }

  const email = parsed.data.email.toLowerCase();
  const exists = await prisma.user.findUnique({ where: { email } });
  if (exists) {
    throw validationError("Email already in use");
  }

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword(parsed.data.password),
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
      tenantId: tenant.id,
    },
    include: { tenant: true },
  });

  await writeAudit({
    actorUserId: session.userId,
    actorTenantId: session.tenantId,
    targetTenantId: tenant.id,
    action: "ADMIN_CREATED",
    metadata: { email: user.email },
  });

  return {
    id: user.id,
    email: user.email,
    role: user.role,
    status: user.status,
    tenantId: user.tenantId,
    tenant: {
      id: user.tenant.id,
      name: user.tenant.name,
      slug: user.tenant.slug,
      type: user.tenant.type,
      status: user.tenant.status,
    },
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

  const where = {
    type: TenantType.SUB,
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
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.tenant.count({ where }),
  ]);

  return { items, total, page, pageSize };
}
