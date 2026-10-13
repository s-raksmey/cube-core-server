import {
  Prisma,
  TenantType,
} from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/src/lib/db";
import type { SessionPayload } from "@/src/lib/auth/session";
import { validationError } from "@/src/lib/errors";
import { displayFullName, findAccountByUuid, getMainTenant } from "@/src/modules/users/account";
import { mapMainTenantUser, requireMainSuperAdmin } from "@/src/modules/users/main-user-shared.service";

const listSchema = z.object({
  search: z.string().trim().max(120).optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(50).default(10),
});
export async function listMainTenantUsers(
  session: SessionPayload,
  input?: { search?: string | null; page?: number | null; pageSize?: number | null },
) {
  await requireMainSuperAdmin(session);
  const parsed = listSchema.safeParse({
    search: input?.search ?? undefined,
    page: input?.page ?? 1,
    pageSize: input?.pageSize ?? 10,
  });
  if (!parsed.success) {
    throw validationError(parsed.error.issues[0]?.message ?? "Invalid input");
  }
  const mainTenant = await getMainTenant();
  const search = parsed.data.search;
  const where: Prisma.TenantMembershipWhereInput = {
    tenantUuid: mainTenant.uuid,
    role: { code: "SUPERADMIN" },
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
        tenant: {
          select: {
            uuid: true,
            name: true,
            slug: true,
            type: true,
            status: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      skip: (parsed.data.page - 1) * parsed.data.pageSize,
      take: parsed.data.pageSize,
    }),
    prisma.tenantMembership.count({ where }),
  ]);

  const items = rows.map(({ user, tenant, status: membershipStatus }) => ({
    id: user.uuid,
    uuid: user.uuid,
    email: user.email,
    username: user.username,
    firstName: user.firstName,
    lastName: user.lastName,
    fullName: displayFullName(user),
    type: "MAIN" as const,
    role: "SUPERADMIN",
    status: user.status,
    membershipStatus,
    tenantId: tenant.uuid,
    tenant: {
      id: tenant.uuid,
      uuid: tenant.uuid,
      name: tenant.name,
      slug: tenant.slug,
      type: tenant.type,
      status: tenant.status,
    },
    createdAt: user.createdAt.toISOString(),
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    totpEnabled: Boolean(user.twoFactorAuth?.enabledAt),
  }));
  return {
    items,
    total,
    page: parsed.data.page,
    pageSize: parsed.data.pageSize,
  };
}

export async function getMainTenantUser(session: SessionPayload, userId: string) {
  await requireMainSuperAdmin(session);
  const account = await findAccountByUuid(userId, undefined, true);
  if (
    !account ||
    account.tenant.type !== TenantType.MAIN ||
    account.roleCode !== "SUPERADMIN"
  ) {
    throw validationError("User not found");
  }
  return mapMainTenantUser(userId);
}

