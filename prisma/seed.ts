import { PrismaClient, TenantType, UserRole } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const mainTenant = await prisma.tenant.findFirst({
    where: { type: TenantType.MAIN },
  });

  if (!mainTenant) {
    throw new Error(
      "Main tenant is missing. Run database migrations first (singleton MAIN tenant is created by migration, not seed).",
    );
  }

  const passwordHash = await bcrypt.hash("Password123!", 12);

  const superAdmin = await prisma.user.upsert({
    where: { email: "superadmin@cube-core.local" },
    update: {
      tenantId: mainTenant.id,
      role: UserRole.SUPERADMIN,
    },
    create: {
      tenantId: mainTenant.id,
      email: "superadmin@cube-core.local",
      passwordHash,
      role: UserRole.SUPERADMIN,
    },
  });

  console.log("Seed complete:");
  console.log({
    mainTenant: mainTenant.slug,
    superAdmin: superAdmin.email,
    defaultPassword: "Password123!",
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
