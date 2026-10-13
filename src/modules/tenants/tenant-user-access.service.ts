import {
  MembershipStatus,
  TenantStatus,
  TenantType,
} from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/src/lib/db";
import type { SessionPayload } from "@/src/lib/auth/session";
import { validationError } from "@/src/lib/errors";
import {
  requireTenantUserPermission,
  type TenantUserPermission,
} from "@/src/modules/roles/role-permission.service";
import { requireMainSuperAdmin } from "@/src/modules/tenants/tenant-console-access.service";

export { requireMainSuperAdmin };

export async function requireTenantAdminTarget(
  session: SessionPayload,
  userId: string,
  permission: TenantUserPermission = "USERS_EDIT",
) {
  await requireTenantUserPermission(session, permission);
  const membership = await prisma.tenantMembership.findFirst({
    where: {
      tenantUuid: session.tenantId,
      userUuid: userId,
      status: { in: [MembershipStatus.ACTIVE, MembershipStatus.DISABLED] },
      role: { code: { in: ["ADMIN", "EDITOR"] } },
      user: { deletedAt: null },
    },
    select: {
      uuid: true,
      userUuid: true,
      status: true,
      role: { select: { code: true } },
      user: { select: { status: true, email: true } },
    },
  });
  if (!membership) throw validationError("User not found");
  if (membership.userUuid === session.userId) {
    throw validationError("You cannot change your own tenant access");
  }
  return membership;
}

export async function requireManagedSubTenantUser(
  session: SessionPayload,
  tenantId: string,
  userId: string,
  permission: TenantUserPermission,
) {
  await requireMainSuperAdmin(session);
  await requireTenantUserPermission(session, permission);
  const parsed = z.object({ tenantId: z.string().uuid(), userId: z.string().uuid() })
    .safeParse({ tenantId, userId });
  if (!parsed.success) {
    throw validationError(parsed.error.issues[0]?.message ?? "Invalid input");
  }
  const membership = await prisma.tenantMembership.findFirst({
    where: {
      tenantUuid: parsed.data.tenantId,
      userUuid: parsed.data.userId,
      status: { in: [MembershipStatus.ACTIVE, MembershipStatus.DISABLED] },
      role: { code: { in: ["ADMIN", "EDITOR"] } },
      tenant: { type: TenantType.SUB, status: TenantStatus.ACTIVE, deletedAt: null },
      user: { deletedAt: null },
    },
    select: {
      uuid: true,
      userUuid: true,
      status: true,
      role: { select: { code: true } },
      user: { select: { email: true, status: true } },
    },
  });
  if (!membership) throw validationError("User not found in this sub-tenant");
  return { ...membership, tenantId: parsed.data.tenantId };
}
