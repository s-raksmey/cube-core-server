import {
  MembershipStatus,
  TenantType,
  UserStatus,
  type AuthAudience,
} from "@prisma/client";
import { prisma } from "@/src/lib/db";
import { forbidden, validationError } from "@/src/lib/errors";

export type LoadedAccount = {
  uuid: string;
  email: string;
  username: string | null;
  firstName: string;
  lastName: string;
  fullName: string;
  passwordHash: string | null;
  status: UserStatus;
  tenantUuid: string;
  roleCode: string;
  membershipUuid: string;
  totpSecretEnc: string | null;
  totpEnabledAt: Date | null;
  sessionsRevokedAt: Date | null;
  lockedUntil: Date | null;
  tenant: {
    uuid: string;
    name: string;
    slug: string;
    type: TenantType;
    status: string;
  };
};

export function displayFullName(user: {
  firstName: string;
  lastName: string;
}) {
  return `${user.firstName} ${user.lastName}`.trim();
}

export function mapAuthUser(account: LoadedAccount) {
  return {
    id: account.uuid,
    uuid: account.uuid,
    email: account.email,
    username: account.username,
    firstName: account.firstName,
    lastName: account.lastName,
    fullName: account.fullName,
    type: account.tenant.type === TenantType.MAIN ? "MAIN" : "SUB",
    role: account.roleCode,
    status: account.status,
    tenantId: account.tenantUuid,
    tenant: {
      id: account.tenant.uuid,
      uuid: account.tenant.uuid,
      name: account.tenant.name,
      slug: account.tenant.slug,
      type: account.tenant.type,
      status: account.tenant.status,
    },
  };
}

async function loadFromMembership(
  userUuid: string,
  tenantUuid?: string,
): Promise<LoadedAccount | null> {
  const membership = await prisma.tenantMembership.findFirst({
    where: {
      userUuid,
      status: MembershipStatus.ACTIVE,
      ...(tenantUuid ? { tenantUuid } : {}),
    },
    include: {
      user: { include: { twoFactorAuth: true } },
      role: true,
      tenant: true,
    },
    orderBy: { createdAt: "asc" },
  });
  if (!membership) return null;
  const { user, role, tenant } = membership;
  return {
    uuid: user.uuid,
    email: user.email,
    username: user.username,
    firstName: user.firstName,
    lastName: user.lastName,
    fullName: displayFullName(user),
    passwordHash: user.passwordHash,
    status: user.status,
    tenantUuid: tenant.uuid,
    roleCode: role.code,
    membershipUuid: membership.uuid,
    totpSecretEnc: user.twoFactorAuth?.encryptedSecret ?? null,
    totpEnabledAt: user.twoFactorAuth?.enabledAt ?? null,
    sessionsRevokedAt: user.sessionsRevokedAt,
    lockedUntil: user.lockedUntil,
    tenant: {
      uuid: tenant.uuid,
      name: tenant.name,
      slug: tenant.slug,
      type: tenant.type,
      status: tenant.status,
    },
  };
}

export async function findAccountByEmailOrUsername(
  identifier: string,
): Promise<LoadedAccount | null> {
  const normalized = identifier.trim().toLowerCase();
  const user = await prisma.user.findFirst({
    where: {
      deletedAt: null,
      OR: [{ email: normalized }, { username: normalized }],
    },
  });
  if (!user) return null;
  return loadFromMembership(user.uuid);
}

export async function findAccountByUuid(
  userUuid: string,
  tenantUuid?: string,
): Promise<LoadedAccount | null> {
  return loadFromMembership(userUuid, tenantUuid);
}

export function assertConsoleAuthorization(
  account: LoadedAccount,
  audience: AuthAudience,
) {
  if (audience === "TENANT_APP") {
    if (account.roleCode === "SUPERADMIN" || account.tenant.type === TenantType.MAIN) {
      throw forbidden("SuperAdmin cannot log into a sub-tenant console");
    }
    if (
      account.roleCode !== "ADMIN" &&
      account.roleCode !== "EDITOR" &&
      account.roleCode !== "AUTHOR"
    ) {
      throw forbidden("Only Admin, Editor, or Author can access the sub-tenant console");
    }
    if (account.tenant.type !== TenantType.SUB) {
      throw forbidden("Sub-tenant console login requires a sub-tenant account");
    }
    return;
  }

  if (account.roleCode !== "SUPERADMIN" || account.tenant.type !== TenantType.MAIN) {
    throw forbidden("Only SuperAdmin can access the main console");
  }
}

export async function getRoleUuid(code: "SUPERADMIN" | "ADMIN" | "EDITOR" | "AUTHOR") {
  const role = await prisma.role.findUnique({ where: { code } });
  if (!role) throw validationError(`Missing role seed: ${code}`);
  return role.uuid;
}

export async function getMainTenant() {
  const main = await prisma.tenant.findFirst({
    where: { type: TenantType.MAIN, deletedAt: null },
  });
  if (!main) throw validationError("Main tenant is missing");
  return main;
}
