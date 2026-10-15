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

const DEFAULT_ADMIN_USER_PERMISSIONS = [
  "USERS_VIEW",
  "USERS_CREATE",
  "USERS_EDIT",
  "USERS_ACTIVATE",
  "USERS_SUSPEND",
  "USERS_RESET_PASSWORD",
  "BRANDING_VIEW",
  "BRANDING_UPDATE",
] as const;

const DEFAULT_EDITOR_USER_PERMISSIONS = [
  "USERS_VIEW",
  "USERS_EDIT",
  "BRANDING_VIEW",
] as const;

const DEFAULT_ADMIN_CATEGORY_PERMISSIONS = [
  "CATEGORY_VIEW", "CATEGORY_VIEW_SUBCATEGORY", "CATEGORY_CREATE", "CATEGORY_CREATE_SUBCATEGORY",
  "CATEGORY_EDIT", "CATEGORY_EDIT_SUBCATEGORY", "CATEGORY_DELETE", "CATEGORY_DELETE_SUBCATEGORY",
  "TAG_VIEW", "TAG_CREATE", "TAG_EDIT", "TAG_DELETE",
] as const;

const DEFAULT_ADMIN_ARTICLE_PERMISSIONS = [
  "ARTICLE_VIEW", "ARTICLE_CREATE", "ARTICLE_UPDATE_OWN", "ARTICLE_UPDATE_ANY",
  "ARTICLE_DELETE_OWN", "ARTICLE_DELETE_ANY", "ARTICLE_DELETE_ARCHIVED", "ARTICLE_SUBMIT", "ARTICLE_REVIEW",
  "ARTICLE_PUBLISH", "ARTICLE_UNPUBLISH", "ARTICLE_SCHEDULE", "ARTICLE_ARCHIVE", "ARTICLE_RESTORE",
  "ARTICLE_SET_BREAKING", "ARTICLE_SET_FEATURED",
] as const;

const DEFAULT_EDITOR_ARTICLE_PERMISSIONS = [
  "ARTICLE_VIEW", "ARTICLE_CREATE", "ARTICLE_UPDATE_OWN", "ARTICLE_DELETE_OWN", "ARTICLE_SUBMIT",
] as const;

const DEFAULT_EDITOR_CATEGORY_PERMISSIONS = ["CATEGORY_VIEW", "CATEGORY_VIEW_SUBCATEGORY", "TAG_VIEW"] as const;

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

  for (const roleUuid of [ROLE_IDS.SUPERADMIN, ROLE_IDS.ADMIN]) {
    const count = await prisma.rolePermission.count({ where: { roleUuid } });
    if (count === 0) await prisma.rolePermission.createMany({
      data: [...DEFAULT_ADMIN_USER_PERMISSIONS, ...DEFAULT_ADMIN_ARTICLE_PERMISSIONS].map((permission) => ({ roleUuid, permission })),
    });
    await prisma.rolePermission.createMany({
      data: DEFAULT_ADMIN_CATEGORY_PERMISSIONS.map((permission) => ({ roleUuid, permission })),
      skipDuplicates: true,
    });
  }

  const editorPermissionCount = await prisma.rolePermission.count({
    where: { roleUuid: ROLE_IDS.EDITOR },
  });
  if (editorPermissionCount === 0) {
    await prisma.rolePermission.createMany({
      data: [...DEFAULT_EDITOR_USER_PERMISSIONS, ...DEFAULT_EDITOR_ARTICLE_PERMISSIONS].map((permission) => ({
        roleUuid: ROLE_IDS.EDITOR,
        permission,
      })),
    });
  }
  await prisma.rolePermission.createMany({
    data: DEFAULT_EDITOR_CATEGORY_PERMISSIONS.map((permission) => ({ roleUuid: ROLE_IDS.EDITOR, permission })),
    skipDuplicates: true,
  });
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
