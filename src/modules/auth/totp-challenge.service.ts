import { AuthAudience, AuthChallengeType } from "@prisma/client";
import { prisma } from "@/src/lib/db";
import {
  CHALLENGE_TTL_MS,
  MAX_CHALLENGE_ATTEMPTS,
} from "@/src/lib/auth/constants";
import { hashToken, randomToken } from "@/src/lib/auth/crypto";
import { totpTimeStep } from "@/src/lib/auth/totp";
import {
  createChallengeToken,
  verifyChallengeToken,
} from "@/src/lib/auth/session";
import { unauthenticated } from "@/src/lib/errors";
import {
  accountLockedNotice,
  accountStatusLoginNotice,
  clearExpiredAccountLockout,
} from "@/src/modules/auth/lockout.service";
import { findAccountByUuid } from "@/src/modules/users/account";
export async function loadChallenge(
  challengeToken: string,
  options: { allowPendingActivation?: boolean } = {},
) {
  let payload;
  try {
    payload = await verifyChallengeToken(challengeToken);
  } catch {
    throw unauthenticated("Sign-in challenge expired. Please sign in again.");
  }

  const tokenHash = hashToken(challengeToken);
  const challenge = await prisma.authLoginChallenge.findUnique({
    where: { uuid: payload.challengeId },
  });

  if (!challenge) {
    throw unauthenticated("Sign-in challenge expired. Please sign in again.");
  }
  if (challenge.consumedAt) {
    throw unauthenticated("Sign-in challenge already used. Please sign in again.");
  }
  if (challenge.expiresAt < new Date()) {
    throw unauthenticated("Sign-in challenge expired. Please sign in again.");
  }
  if (challenge.tokenHash !== tokenHash) {
    throw unauthenticated("Invalid sign-in challenge. Please sign in again.");
  }
  if (challenge.userUuid !== payload.userId || challenge.audience !== payload.audience) {
    throw unauthenticated("Invalid sign-in challenge. Please sign in again.");
  }

  let account = await findAccountByUuid(challenge.userUuid, challenge.tenantUuid);
  if (!account) {
    throw unauthenticated("Invalid sign-in challenge. Please sign in again.");
  }
  if (account.status === "LOCKED") {
    const unlocked = await clearExpiredAccountLockout(account.uuid);
    if (unlocked) account = await findAccountByUuid(challenge.userUuid, challenge.tenantUuid);
    if (!account || account.status === "LOCKED") {
      throw unauthenticated(accountLockedNotice(account?.lockedUntil ?? null));
    }
  }

  const statusNotice = accountStatusLoginNotice(account.status);
  const pendingActivationEnrollment = permitsPendingActivationEnrollment(
    options,
    challenge,
    account,
  );
  if (statusNotice && !pendingActivationEnrollment) {
    throw unauthenticated(statusNotice);
  }

  return { challenge, payload, account };
}

/**
 * Activation enrollment is the sole TOTP operation permitted for a pending
 * account. Both consoles can create this challenge: SuperAdmins activate
 * Main-tenant users and SuperAdmins activate Sub-tenant Admins/Editors.
 */
export function permitsPendingActivationEnrollment(
  options: { allowPendingActivation?: boolean },
  challenge: { type: AuthChallengeType; audience: AuthAudience },
  account: { status: string },
) {
  return (
    options.allowPendingActivation === true &&
    challenge.type === AuthChallengeType.TOTP_ENROLL &&
    (challenge.audience === AuthAudience.ADMIN_CONSOLE ||
      challenge.audience === AuthAudience.TENANT_APP) &&
    account.status === "PENDING"
  );
}

export async function incrementFailedAttempt(challengeId: string) {
  const updated = await prisma.authLoginChallenge.update({
    where: { uuid: challengeId },
    data: { attemptCount: { increment: 1 } },
  });
  if (updated.attemptCount >= MAX_CHALLENGE_ATTEMPTS) {
    await prisma.authLoginChallenge.update({
      where: { uuid: challengeId },
      data: { consumedAt: new Date() },
    });
  }
  return updated.attemptCount;
}

export async function consumeChallenge(challengeId: string) {
  const result = await prisma.authLoginChallenge.updateMany({
    where: { uuid: challengeId, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  if (result.count !== 1) {
    throw unauthenticated("Challenge already used");
  }
}

export async function assertTotpNotReplayed(userUuid: string, secret: string, code: string) {
  const step = await totpTimeStep(code, secret);
  if (step === null) return false;
  try {
    await prisma.authTotpReplayGuard.create({
      data: { userUuid, timeStep: step },
    });
    return true;
  } catch {
    throw unauthenticated("This code was already used. Wait for the next code.");
  }
}

export async function createLoginChallenge(input: {
  userUuid: string;
  tenantUuid: string;
  audience: AuthAudience;
  type: AuthChallengeType;
}) {
  await prisma.authLoginChallenge.updateMany({
    where: { userUuid: input.userUuid, consumedAt: null },
    data: { consumedAt: new Date() },
  });

  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS);
  const challenge = await prisma.authLoginChallenge.create({
    data: {
      userUuid: input.userUuid,
      tenantUuid: input.tenantUuid,
      audience: input.audience,
      type: input.type,
      tokenHash: hashToken(randomToken(32)),
      expiresAt,
    },
  });

  const signed = await createChallengeToken({
    challengeId: challenge.uuid,
    userId: input.userUuid,
    tenantId: input.tenantUuid,
    audience: input.audience,
    type: input.type,
  });

  await prisma.authLoginChallenge.update({
    where: { uuid: challenge.uuid },
    data: { tokenHash: hashToken(signed) },
  });

  return { challengeToken: signed, challengeId: challenge.uuid };
}

