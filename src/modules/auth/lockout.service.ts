import { UserStatus } from "@prisma/client";
import { prisma } from "@/src/lib/db";
import {
  ACCOUNT_LOCKOUT_TTL_MS,
  MAX_ACCOUNT_AUTH_ATTEMPTS,
} from "@/src/lib/auth/constants";
import { unauthenticated } from "@/src/lib/errors";
import { writeAuthAudit } from "@/src/modules/auth/audit-auth";
import type { LoadedAccount } from "@/src/modules/users/account";

export type FailedAuthMethod = "password" | "totp";
export const INVALID_PASSWORD_LOGIN_NOTICE =
  "Incorrect username/email or password. Try again, or contact your administrator if your account is locked.";

export function failedAttemptOutcome(count: number) {
  return count >= MAX_ACCOUNT_AUTH_ATTEMPTS
    ? { locked: true as const, remaining: 0 }
    : { locked: false as const, remaining: Math.max(0, MAX_ACCOUNT_AUTH_ATTEMPTS - count) };
}

export function failedAttemptNotice(method: FailedAuthMethod, remaining: number) {
  if (method === "password") {
    return INVALID_PASSWORD_LOGIN_NOTICE;
  }
  return `Incorrect verification code. ${remaining} verification attempt${remaining === 1 ? "" : "s"} remaining before a temporary account lock.`;
}

export function accountLockedNotice(lockedUntil: Date | null) {
  if (!lockedUntil) {
    return "This account is locked. Contact a SuperAdmin to restore access.";
  }
  const minutesRemaining = Math.max(
    1,
    Math.ceil((lockedUntil.getTime() - Date.now()) / 60_000),
  );
  return `This account is temporarily locked after repeated failed sign-in attempts. Try again in ${minutesRemaining} minute${minutesRemaining === 1 ? "" : "s"} or contact a SuperAdmin for help.`;
}

export async function clearExpiredAccountLockout(userUuid: string) {
  const now = new Date();
  const account = await prisma.user.findFirst({
    where: { uuid: userUuid, status: UserStatus.LOCKED, lockedUntil: { lte: now } },
    select: { lockedUntil: true, activatedAt: true },
  });
  if (!account?.lockedUntil) return false;
  const result = await prisma.user.updateMany({
    where: {
      uuid: userUuid,
      status: UserStatus.LOCKED,
      lockedUntil: account.lockedUntil,
    },
    data: {
      status: account.activatedAt ? UserStatus.ACTIVE : UserStatus.PENDING,
      lockedUntil: null,
      failedPasswordAttempts: 0,
      failedTotpAttempts: 0,
    },
  });
  if (result.count) {
    await writeAuthAudit({
      action: "auth.account.lockout_expired",
      actorUserUuid: userUuid,
      metadata: { unlockedAt: now.toISOString() },
    });
  }
  return result.count > 0;
}

export async function resetFailedPasswordAttempts(userUuid: string) {
  await prisma.user.updateMany({
    where: { uuid: userUuid, status: UserStatus.ACTIVE },
    data: { failedPasswordAttempts: 0 },
  });
}

export async function resetFailedTotpAttempts(userUuid: string) {
  await prisma.user.updateMany({
    where: { uuid: userUuid, status: { in: [UserStatus.ACTIVE, UserStatus.PENDING] } },
    data: { failedTotpAttempts: 0 },
  });
}

export async function recordFailedAuthAttempt(
  account: LoadedAccount,
  method: FailedAuthMethod,
) {
  const result = await prisma.$transaction(async (tx) => {
    const updated = method === "password"
      ? await tx.user.update({
          where: { uuid: account.uuid },
          data: { failedPasswordAttempts: { increment: 1 } },
          select: { failedPasswordAttempts: true },
        })
      : await tx.user.update({
          where: { uuid: account.uuid },
          data: { failedTotpAttempts: { increment: 1 } },
          select: { failedTotpAttempts: true },
        });
    const count = "failedPasswordAttempts" in updated
      ? updated.failedPasswordAttempts
      : updated.failedTotpAttempts;
    if (count < MAX_ACCOUNT_AUTH_ATTEMPTS) {
      return { count, transitionedToLocked: false, lockedUntil: null as Date | null };
    }

    const now = new Date();
    const lockedUntil = new Date(now.getTime() + ACCOUNT_LOCKOUT_TTL_MS);
    const thresholdField = method === "password"
      ? { failedPasswordAttempts: { gte: MAX_ACCOUNT_AUTH_ATTEMPTS } }
      : { failedTotpAttempts: { gte: MAX_ACCOUNT_AUTH_ATTEMPTS } };
    const transition = await tx.user.updateMany({
      where: {
        uuid: account.uuid,
        status: { in: [UserStatus.ACTIVE, UserStatus.PENDING] },
        ...thresholdField,
      },
      data: { status: UserStatus.LOCKED, lockedUntil },
    });
    if (transition.count) {
      await tx.userSession.updateMany({
        where: { userUuid: account.uuid, revokedAt: null },
        data: { revokedAt: now },
      });
      await tx.authLoginChallenge.updateMany({
        where: { userUuid: account.uuid, consumedAt: null },
        data: { consumedAt: now },
      });
    }
    return { count, transitionedToLocked: transition.count > 0, lockedUntil };
  });

  const outcome = failedAttemptOutcome(result.count);
  if (result.transitionedToLocked) {
    await writeAuthAudit({
      action: "auth.account.locked",
      actorUserUuid: account.uuid,
      tenantUuid: account.tenantUuid,
      metadata: { method, lockedUntil: result.lockedUntil?.toISOString() },
    });
  }
  return outcome;
}
