import type { Prisma } from "@prisma/client";
import { prisma } from "@/src/lib/db";

export const LOCAL_DEVELOPMENT_HOSTNAME = "localhost";

/**
 * Changes the sole local routing assignment in the caller's transaction.
 * The hostname primary key makes the switch atomic: there can be only one
 * selected sub-tenant for the shared local console and website.
 */
export async function setLocalDevelopmentAssignment(
  tx: Prisma.TransactionClient,
  tenantUuid: string,
  hostname: string | null,
) {
  if (hostname === null) {
    await tx.localDevelopmentTenant.deleteMany({ where: { tenantUuid } });
    return null;
  }

  return tx.localDevelopmentTenant.upsert({
    where: { hostname: LOCAL_DEVELOPMENT_HOSTNAME },
    create: { hostname: LOCAL_DEVELOPMENT_HOSTNAME, tenantUuid },
    update: { tenantUuid },
    select: { hostname: true },
  });
}

/** Public, safe identity lookup for the shared local applications only. */
export async function findLocalDevelopmentTenant() {
  if (process.env.NODE_ENV === "production") return null;

  const assignment = await prisma.localDevelopmentTenant.findUnique({
    where: { hostname: LOCAL_DEVELOPMENT_HOSTNAME },
    select: {
      tenant: {
        select: {
          uuid: true,
          name: true,
          slug: true,
          type: true,
          status: true,
          deletedAt: true,
        },
      },
    },
  });
  const tenant = assignment?.tenant;
  if (!tenant || tenant.type !== "SUB" || tenant.status !== "ACTIVE" || tenant.deletedAt) {
    return null;
  }
  return tenant;
}
