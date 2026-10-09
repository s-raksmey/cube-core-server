import { TenantStatus, UserRole, UserStatus } from "@prisma/client";
import { prisma } from "@/src/lib/db";
import { verifyPassword } from "@/src/lib/auth/password";
import { createSessionToken } from "@/src/lib/auth/session";
import { forbidden, unauthenticated, validationError } from "@/src/lib/errors";

export type LoginAudience = "ADMIN_CONSOLE" | "TENANT_APP";

export async function login(
  email: string,
  password: string,
  audience: LoginAudience = "ADMIN_CONSOLE",
) {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || !password) {
    throw validationError("Email and password are required");
  }

  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    include: { tenant: true },
  });

  if (!user || user.status !== UserStatus.ACTIVE) {
    throw unauthenticated("Invalid email or password");
  }

  if (user.tenant.status === TenantStatus.SUSPENDED) {
    throw forbidden("Tenant is suspended");
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    throw unauthenticated("Invalid email or password");
  }

  // SuperAdmin cannot log into the sub-tenant app.
  if (audience === "TENANT_APP") {
    if (user.role === UserRole.SUPERADMIN) {
      throw forbidden("SuperAdmin cannot log into a sub-tenant");
    }
    if (user.role !== UserRole.ADMIN && user.role !== UserRole.EDITOR) {
      throw forbidden("Only Admin or Editor can access the tenant app");
    }
    if (user.tenant.type !== "SUB") {
      throw forbidden("Tenant app login requires a sub-tenant account");
    }
  } else {
    // Admin console: SuperAdmin on main; Admin/Editor on sub-tenant.
    if (user.role === UserRole.SUPERADMIN && user.tenant.type !== "MAIN") {
      throw forbidden("SuperAdmin must belong to the main tenant");
    }
    if (
      (user.role === UserRole.ADMIN || user.role === UserRole.EDITOR) &&
      user.tenant.type !== "SUB"
    ) {
      throw forbidden("Admin and Editor must belong to a sub-tenant");
    }
  }

  const token = await createSessionToken({
    userId: user.id,
    role: user.role,
    tenantId: user.tenantId,
  });

  return {
    token,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
      tenant: {
        id: user.tenant.id,
        name: user.tenant.name,
        slug: user.tenant.slug,
        type: user.tenant.type,
        status: user.tenant.status,
      },
    },
  };
}

export async function getMe(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { tenant: true },
  });

  if (!user || user.status !== UserStatus.ACTIVE) {
    throw unauthenticated();
  }

  if (user.tenant.status === TenantStatus.SUSPENDED) {
    throw forbidden("Tenant is suspended");
  }

  return {
    id: user.id,
    email: user.email,
    role: user.role,
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
