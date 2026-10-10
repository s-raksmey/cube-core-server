import {
  MembershipStatus,
  PrismaClient,
  TenantType,
  UserStatus,
} from "@prisma/client";
import { hashPasswordBcrypt } from "../src/lib/auth/password";

const prisma = new PrismaClient();

const ROLE_IDS = {
  SUPERADMIN: "00000000-0000-4000-8000-000000000001",
  ADMIN: "00000000-0000-4000-8000-000000000002",
  EDITOR: "00000000-0000-4000-8000-000000000003",
} as const;

async function ensureRoles() {
  const roles = [
    {
      uuid: ROLE_IDS.SUPERADMIN,
      code: "SUPERADMIN",
      name: "Super Admin",
      description: "Main Tenant platform operator",
    },
    {
      uuid: ROLE_IDS.ADMIN,
      code: "ADMIN",
      name: "Admin",
      description: "Sub-tenant administrator",
    },
    {
      uuid: ROLE_IDS.EDITOR,
      code: "EDITOR",
      name: "Editor",
      description: "Sub-tenant editor",
    },
  ] as const;

  for (const role of roles) {
    await prisma.role.upsert({
      where: { code: role.code },
      update: { name: role.name, description: role.description },
      create: role,
    });
  }
}

async function main() {
  await ensureRoles();

  const mainTenant = await prisma.tenant.findFirst({
    where: { type: TenantType.MAIN, deletedAt: null },
  });

  if (!mainTenant) {
    throw new Error(
      "Main tenant is missing. Run database migrations first (singleton MAIN tenant is created by migration, not seed).",
    );
  }

  const passwordHash = await hashPasswordBcrypt("Password123!");

  const superAdmin = await prisma.user.upsert({
    where: { email: "superadmin@cube-core.local" },
    update: {
      firstName: "Cube",
      lastName: "Super Admin",
      username: "superadmin",
      passwordHash,
      status: UserStatus.ACTIVE,
      activatedAt: new Date(),
    },
    create: {
      email: "superadmin@cube-core.local",
      firstName: "Cube",
      lastName: "Super Admin",
      username: "superadmin",
      passwordHash,
      status: UserStatus.ACTIVE,
      activatedAt: new Date(),
    },
  });

  await prisma.tenantMembership.upsert({
    where: {
      userUuid_tenantUuid: {
        userUuid: superAdmin.uuid,
        tenantUuid: mainTenant.uuid,
      },
    },
    update: {
      roleUuid: ROLE_IDS.SUPERADMIN,
      status: MembershipStatus.ACTIVE,
    },
    create: {
      userUuid: superAdmin.uuid,
      tenantUuid: mainTenant.uuid,
      roleUuid: ROLE_IDS.SUPERADMIN,
      status: MembershipStatus.ACTIVE,
    },
  });

  console.log("Seed complete:");
  console.log({
    mainTenant: mainTenant.slug,
    user: superAdmin.email,
    username: superAdmin.username,
    role: "SUPERADMIN",
    defaultPassword: "Password123!",
    note: "Enable TOTP on first login (or after re-seed).",
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
