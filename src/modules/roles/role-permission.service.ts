import { MembershipStatus, TenantStatus, TenantType, UserStatus } from "@prisma/client";
import { z } from "zod";
import type { SessionPayload } from "@/src/lib/auth/session";
import { prisma } from "@/src/lib/db";
import { forbidden, validationError } from "@/src/lib/errors";
import { writeAuthAudit } from "@/src/modules/auth/audit-auth";

export const tenantUserPermissionCodes = [
  "USERS_VIEW",
  "USERS_CREATE",
  "USERS_EDIT",
  "USERS_CHANGE_ROLE",
  "USERS_ACTIVATE",
  "USERS_SUSPEND",
  "USERS_RESET_PASSWORD",
  "USERS_DELETE",
  "SETTINGS_VIEW",
  "SETTINGS_UPDATE",
  "CATEGORY_VIEW",
  "CATEGORY_VIEW_SUBCATEGORY",
  "TAG_VIEW",
  "CATEGORY_CREATE",
  "CATEGORY_CREATE_SUBCATEGORY",
  "CATEGORY_EDIT",
  "CATEGORY_EDIT_SUBCATEGORY",
  "CATEGORY_DELETE",
  "CATEGORY_DELETE_SUBCATEGORY",
  "TAG_CREATE", "TAG_EDIT", "TAG_DELETE",
  "ARTICLE_VIEW", "ARTICLE_CREATE", "ARTICLE_UPDATE_OWN", "ARTICLE_UPDATE_ANY",
  "ARTICLE_DELETE_OWN", "ARTICLE_DELETE_ANY", "ARTICLE_DELETE_ARCHIVED", "ARTICLE_SUBMIT", "ARTICLE_REVIEW", "ARTICLE_REQUEST_CHANGES",
  "ARTICLE_PUBLISH", "ARTICLE_UNPUBLISH", "ARTICLE_SCHEDULE", "ARTICLE_ARCHIVE", "ARTICLE_RESTORE",
  "ARTICLE_SET_BREAKING", "ARTICLE_SET_FEATURED",
  "ANALYTICS_VIEW_TENANT", "ANALYTICS_VIEW_OWN",
] as const;

export const articlePermissionCodes = tenantUserPermissionCodes.filter(
  (permission) => permission.startsWith("ARTICLE_"),
);

export type TenantUserPermission = (typeof tenantUserPermissionCodes)[number];

function isTenantUserPermission(permission: string): permission is TenantUserPermission {
  return tenantUserPermissionCodes.includes(permission as TenantUserPermission);
}

/** Editor can manage user profiles and view the tenant settings, but cannot edit settings. */
export const allowedEditorUserPermissions = [
  "USERS_VIEW",
  "USERS_EDIT",
  "SETTINGS_VIEW",
  "CATEGORY_VIEW",
  "CATEGORY_VIEW_SUBCATEGORY",
  "TAG_VIEW",
  "ANALYTICS_VIEW_OWN",
  ...articlePermissionCodes,
] as const satisfies readonly TenantUserPermission[];

const updateRolePermissionsSchema = z.object({
  role: z.enum(["SUPERADMIN", "ADMIN", "EDITOR"]),
  permissions: z.array(z.enum(tenantUserPermissionCodes)).max(tenantUserPermissionCodes.length),
}).superRefine((value, ctx) => {
  if (new Set(value.permissions).size !== value.permissions.length) {
    ctx.addIssue({ code: "custom", path: ["permissions"], message: "Permissions must be unique" });
  }
  const hasUserManagementAction = value.permissions.some(
    (permission) => permission.startsWith("USERS_") && permission !== "USERS_VIEW",
  );
  if (hasUserManagementAction && !value.permissions.includes("USERS_VIEW")) {
    ctx.addIssue({
      code: "custom",
      path: ["permissions"],
      message: "View users is required for every other user-management permission",
    });
  }
  if (value.permissions.some(permission => permission.startsWith("TAG_") && permission !== "TAG_VIEW") && !value.permissions.includes("TAG_VIEW")) {
    ctx.addIssue({ code: "custom", path: ["permissions"], message: "View tags is required for tag management permissions" });
  }
  if (value.permissions.includes("SETTINGS_UPDATE") && !value.permissions.includes("SETTINGS_VIEW")) {
    ctx.addIssue({ code: "custom", path: ["permissions"], message: "View settings is required to update settings" });
  }
  if (value.permissions.some(permission => permission.startsWith("ARTICLE_") && permission !== "ARTICLE_VIEW") && !value.permissions.includes("ARTICLE_VIEW")) {
    ctx.addIssue({ code: "custom", path: ["permissions"], message: "View articles is required for article management permissions" });
  }
  const hasCategoryAction = value.permissions.some(
    (permission) => permission.startsWith("CATEGORY_") && permission !== "CATEGORY_VIEW" && permission !== "CATEGORY_VIEW_SUBCATEGORY",
  );
  if (hasCategoryAction && !value.permissions.includes("CATEGORY_VIEW")) {
    ctx.addIssue({ code: "custom", path: ["permissions"], message: "View category is required for category management permissions" });
  }
  const hasSubcategoryAction = value.permissions.some(
    (permission) => permission.endsWith("SUBCATEGORY") && permission !== "CATEGORY_VIEW_SUBCATEGORY",
  );
  if (hasSubcategoryAction && !value.permissions.includes("CATEGORY_VIEW_SUBCATEGORY")) {
    ctx.addIssue({ code: "custom", path: ["permissions"], message: "View sub category is required for sub category management permissions" });
  }
});

async function requireMainSuperAdmin(session: SessionPayload) {
  if (session.role !== "SUPERADMIN" || session.audience !== "ADMIN_CONSOLE") {
    throw forbidden("SuperAdmin only");
  }
  const membership = await prisma.tenantMembership.findFirst({
    where: {
      userUuid: session.userId,
      tenantUuid: session.tenantId,
      status: MembershipStatus.ACTIVE,
      role: { code: "SUPERADMIN" },
      tenant: { type: TenantType.MAIN, status: TenantStatus.ACTIVE, deletedAt: null },
      user: { status: UserStatus.ACTIVE, deletedAt: null },
    },
    select: { uuid: true },
  });
  if (!membership) throw forbidden("SuperAdmin access is required");
}

export async function listTenantRolePermissions(session: SessionPayload) {
  await requireMainSuperAdmin(session);
  const roles = await prisma.role.findMany({
    where: { code: { in: ["SUPERADMIN", "ADMIN", "EDITOR"] } },
    select: { code: true, permissions: { select: { permission: true } } },
  });
  const byCode = new Map(roles.map((role) => [role.code, role.permissions.map((entry) => entry.permission).filter(isTenantUserPermission)]));
  return ["SUPERADMIN", "ADMIN", "EDITOR"].map((role) => ({
    role,
    permissions: byCode.get(role) ?? [],
  }));
}

export async function listTenantRolePermissionSummary(session: SessionPayload) {
  await getTenantUserPermissions(session);
  const roles = await prisma.role.findMany({
    where: { code: { in: ["ADMIN", "EDITOR"] } },
    select: { code: true, permissions: { select: { permission: true } } },
  });
  const byCode = new Map(roles.map((role) => [role.code, role.permissions.map((entry) => entry.permission).filter(isTenantUserPermission)]));
  return ["ADMIN", "EDITOR"].map((role) => ({
    role,
    permissions: byCode.get(role) ?? [],
  }));
}

export async function updateTenantRolePermissions(session: SessionPayload, input: unknown) {
  await requireMainSuperAdmin(session);
  const parsed = updateRolePermissionsSchema.safeParse(input);
  if (!parsed.success) throw validationError(parsed.error.issues[0]?.message ?? "Invalid role permissions");
  if (
    parsed.data.role === "EDITOR" &&
    parsed.data.permissions.some(
      (permission) =>
        !(allowedEditorUserPermissions as readonly TenantUserPermission[]).includes(
          permission,
        ),
    )
  ) {
    throw validationError("Editor cannot be granted this user or settings permission.");
  }

  const role = await prisma.role.findUnique({
    where: { code: parsed.data.role },
    select: { uuid: true },
  });
  if (!role) throw validationError("Role not found");

  await prisma.$transaction(async (tx) => {
    await tx.rolePermission.deleteMany({ where: { roleUuid: role.uuid } });
    if (parsed.data.permissions.length) {
      await tx.rolePermission.createMany({
        data: parsed.data.permissions.map((permission) => ({ roleUuid: role.uuid, permission })),
      });
    }
    await writeAuthAudit({
      action: "SUB_TENANT_ROLE_PERMISSIONS_UPDATED",
      actorUserUuid: session.userId,
      tenantUuid: session.tenantId,
      targetType: "role",
      targetUuid: role.uuid,
      metadata: { role: parsed.data.role, permissions: parsed.data.permissions },
    }, tx);
  });

  return { role: parsed.data.role, permissions: parsed.data.permissions };
}

export async function getTenantUserPermissions(session: SessionPayload) {
  if (session.role === "SUPERADMIN") {
    await requireMainSuperAdmin(session);
    const role = await prisma.role.findUnique({
      where: { code: "SUPERADMIN" },
      select: { permissions: { select: { permission: true } } },
    });
    return (role?.permissions ?? [])
      .map((entry) => entry.permission)
      .filter(isTenantUserPermission);
  }
  const membership = await prisma.tenantMembership.findFirst({
    where: {
      userUuid: session.userId,
      tenantUuid: session.tenantId,
      status: MembershipStatus.ACTIVE,
      tenant: { type: TenantType.SUB, status: TenantStatus.ACTIVE, deletedAt: null },
      user: { status: UserStatus.ACTIVE, deletedAt: null },
      role: { code: { in: ["ADMIN", "EDITOR"] } },
    },
    select: {
      role: {
        select: {
          code: true,
          permissions: { select: { permission: true } },
        },
      },
    },
  });
  if (!membership) throw forbidden("You do not have access to this tenant");
  const permissions = membership.role.permissions
    .map((entry) => entry.permission)
    .filter(isTenantUserPermission);

  return membership.role.code === "EDITOR"
    ? permissions.filter((permission) =>
        (allowedEditorUserPermissions as readonly TenantUserPermission[]).includes(
          permission,
        ),
      )
    : permissions;
}

export async function requireTenantUserPermission(
  session: SessionPayload,
  permission: TenantUserPermission,
) {
  if (session.role === "SUPERADMIN") {
    await requireMainSuperAdmin(session);
    const role = await prisma.role.findUnique({ where: { code: "SUPERADMIN" }, select: { permissions: { select: { permission: true } } } });
    if (!role?.permissions.some((entry) => entry.permission === permission)) throw forbidden("You do not have permission to perform this action");
    return;
  }
  const permissions = await getTenantUserPermissions(session);
  if (!permissions.includes(permission)) {
    throw forbidden("You do not have permission to perform this action");
  }
}
