import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/src/lib/db";
import type { SessionPayload } from "@/src/lib/auth/session";
import { forbidden, validationError } from "@/src/lib/errors";
import { displayFullName } from "./account";
import { saveProfileImage, removeProfileImage } from "./profile-image.service";
import { writeAuthAudit } from "@/src/modules/auth/audit-auth";

export const profileInputSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  username: z.string().trim().toLowerCase().min(2).max(40).regex(/^[a-zA-Z0-9._-]+$/).nullable().optional(),
  image: z.object({ fileName: z.string().max(200), mimeType: z.string().max(80), contentBase64: z.string().max(4_096_004) }).nullish(),
  removeImage: z.boolean().default(false),
}).strict().refine((value) => !(value.image && value.removeImage), "Choose an image or remove it, not both");

const profileSelect = {
  status: true,
  role: { select: { code: true } },
  tenant: { select: { uuid: true, name: true, slug: true, type: true, status: true } },
  user: { select: { uuid: true, email: true, username: true, firstName: true, lastName: true, avatarPath: true, status: true } },
} satisfies Prisma.TenantMembershipSelect;

export async function getProfile(userId: string, tenantId?: string) {
  const membership = await prisma.tenantMembership.findFirst({
    where: { userUuid: userId, ...(tenantId ? { tenantUuid: tenantId } : {}), status: "ACTIVE",
      user: { status: "ACTIVE", deletedAt: null }, tenant: { status: "ACTIVE", deletedAt: null } },
    select: profileSelect, orderBy: [{ createdAt: "asc" }, { uuid: "asc" }],
  });
  if (!membership) return null;
  const { user, tenant, role } = membership;
  return { id: user.uuid, uuid: user.uuid, email: user.email, username: user.username,
    firstName: user.firstName, lastName: user.lastName, fullName: displayFullName(user), avatarUrl: user.avatarPath,
    status: user.status, membershipStatus: membership.status, type: tenant.type, role: role.code, tenantId: tenant.uuid,
    tenant: { id: tenant.uuid, uuid: tenant.uuid, name: tenant.name, slug: tenant.slug, type: tenant.type, status: tenant.status } };
}

export async function updateMyProfile(session: SessionPayload, input: unknown) {
  const parsed = profileInputSchema.safeParse(input);
  if (!parsed.success) throw validationError(parsed.error.issues[0]?.message ?? "Invalid profile");
  const main = session.audience === "ADMIN_CONSOLE" && session.role === "SUPERADMIN";
  const sub = session.audience === "TENANT_APP" && ["ADMIN", "EDITOR"].includes(session.role);
  if (!main && !sub) throw forbidden();
  const membership = await prisma.tenantMembership.findFirst({
    where: { userUuid: session.userId, tenantUuid: session.tenantId, status: "ACTIVE", role: { code: session.role },
      tenant: { type: main ? "MAIN" : "SUB", status: "ACTIVE", deletedAt: null }, user: { status: "ACTIVE", deletedAt: null } },
    select: { user: { select: { avatarPath: true } } },
  });
  if (!membership) throw forbidden("Your profile is unavailable for this session");
  const data = parsed.data;
  const image = data.image ? await saveProfileImage(session.userId, data.image) : null;
  try {
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { uuid: session.userId }, data: {
        firstName: data.firstName, lastName: data.lastName,
        ...(data.username !== undefined ? { username: data.username } : {}),
        ...(image ? { avatarPath: image } : data.removeImage ? { avatarPath: null } : {}),
      }, select: { uuid: true } });
      await writeAuthAudit({ action: "USER_PROFILE_UPDATED", actorUserUuid: session.userId, tenantUuid: session.tenantId,
        targetType: "user", targetUuid: session.userId, metadata: { imageChanged: Boolean(image || data.removeImage) } }, tx);
    });
  } catch (error) {
    if (image) await removeProfileImage(session.userId, image).catch(() => undefined);
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw validationError("Username is already in use");
    throw error;
  }
  if (image || data.removeImage) await removeProfileImage(session.userId, membership.user.avatarPath).catch(() => undefined);
  return getProfile(session.userId, session.tenantId);
}
