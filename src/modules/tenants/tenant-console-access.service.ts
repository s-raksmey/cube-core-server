import type { SessionPayload } from "@/src/lib/auth/session";
import { forbidden } from "@/src/lib/errors";
import { getMainTenant } from "@/src/modules/users/account";

export async function requireSuperAdmin(session: SessionPayload) {
  if (session.role !== "SUPERADMIN") {
    throw forbidden("SuperAdmin only");
  }
}

export async function requireMainSuperAdmin(session: SessionPayload) {
  await requireSuperAdmin(session);
  const mainTenant = await getMainTenant();
  if (session.tenantId !== mainTenant.uuid) {
    throw forbidden("SuperAdmin must use the Main Tenant session");
  }
}