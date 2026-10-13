import { prisma } from "@/src/lib/db";
import type { SessionPayload } from "@/src/lib/auth/session";
import { forbidden, validationError } from "@/src/lib/errors";
import {
  findAccountByUuid,
  mapAuthUser,
} from "@/src/modules/users/account";

export async function requireMainSuperAdmin(session: SessionPayload) {
  if (session.role !== "SUPERADMIN") {
    throw forbidden("SuperAdmin only");
  }
}

export async function mapMainTenantUser(userUuid: string) {
  const account = await findAccountByUuid(userUuid, undefined, true);
  if (!account) throw validationError("User not found");
  const mapped = mapAuthUser(account);
  const user = await prisma.user.findUniqueOrThrow({
    where: { uuid: userUuid },
    select: { createdAt: true, lastLoginAt: true },
  });
  return {
    ...mapped,
    createdAt: user.createdAt.toISOString(),
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    totpEnabled: Boolean(account.totpEnabledAt),
  };
}