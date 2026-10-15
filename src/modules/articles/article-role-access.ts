import { MembershipStatus } from "@prisma/client";
import type { SessionPayload } from "@/src/lib/auth/session";
import { prisma } from "@/src/lib/db";
import { forbidden } from "@/src/lib/errors";

/** Article permissions may grant Editor cross-author access, but never access to an Admin's article. */
export async function assertCanManageArticleAuthor(session: SessionPayload, authorId: string | null) {
  if (authorId === session.userId) return;
  const memberships = await prisma.tenantMembership.findMany({
    where: { tenantUuid: session.tenantId, userUuid: { in: [session.userId, ...(authorId ? [authorId] : [])] } },
    select: { userUuid: true, status: true, role: { select: { code: true } } },
  });
  const actor = memberships.find((membership) => membership.userUuid === session.userId);
  if (!actor || actor.status !== MembershipStatus.ACTIVE || actor.role.code !== session.role) {
    throw forbidden("Your tenant role has changed. Sign in again");
  }
  if (actor.role.code === "ADMIN") return;
  const author = memberships.find((membership) => membership.userUuid === authorId);
  if (actor.role.code !== "EDITOR" || author?.role.code !== "EDITOR") {
    throw forbidden("Editors cannot manage an Admin's article");
  }
}

export async function articleAuthorRoles(tenantUuid: string, authorIds: (string | null)[]) {
  const ids = [...new Set(authorIds.filter((id): id is string => Boolean(id)))];
  if (!ids.length) return new Map<string, "ADMIN" | "EDITOR">();
  const memberships = await prisma.tenantMembership.findMany({
    where: { tenantUuid, userUuid: { in: ids } },
    select: { userUuid: true, role: { select: { code: true } } },
  });
  return new Map(memberships.flatMap(({ userUuid, role }) =>
    role.code === "ADMIN" || role.code === "EDITOR" ? [[userUuid, role.code] as const] : []));
}
