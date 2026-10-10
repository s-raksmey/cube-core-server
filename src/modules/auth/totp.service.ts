import { AuthAudience, AuthChallengeType } from "@prisma/client";
import { prisma } from "@/src/lib/db";
import {
  CHALLENGE_TTL_MS,
  MAX_CHALLENGE_ATTEMPTS,
  RECOVERY_CODE_COUNT,
  TOTP_PENDING_TTL_MS,
} from "@/src/lib/auth/constants";
import {
  decryptAtRest,
  encryptAtRest,
  hashToken,
  randomToken,
} from "@/src/lib/auth/crypto";
import {
  buildOtpAuthUri,
  generateTotpSecret,
  qrCodeDataUrl,
  totpTimeStep,
  verifyTotpCode,
} from "@/src/lib/auth/totp";
import {
  createChallengeToken,
  verifyChallengeToken,
} from "@/src/lib/auth/session";
import { hashPassword, verifyPassword } from "@/src/lib/auth/password";
import { forbidden, unauthenticated, validationError } from "@/src/lib/errors";
import { writeAuthAudit } from "@/src/modules/auth/audit-auth";
import {
  accountLockedNotice,
  clearExpiredAccountLockout,
  failedAttemptNotice,
  recordFailedAuthAttempt,
  resetFailedTotpAttempts,
} from "@/src/modules/auth/lockout.service";
import { createAuthenticatedSession } from "@/src/modules/auth/session.service";
import {
  findAccountByUuid,
  mapAuthUser,
} from "@/src/modules/users/account";

async function loadChallenge(challengeToken: string) {
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

  return { challenge, payload, account };
}

async function incrementFailedAttempt(challengeId: string) {
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

async function consumeChallenge(challengeId: string) {
  const result = await prisma.authLoginChallenge.updateMany({
    where: { uuid: challengeId, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  if (result.count !== 1) {
    throw unauthenticated("Challenge already used");
  }
}

async function assertTotpNotReplayed(userUuid: string, secret: string, code: string) {
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

export async function beginTotpEnrollment(input: {
  userUuid: string;
  tenantUuid: string;
  email: string;
  audience: AuthAudience;
}) {
  const secret = generateTotpSecret();
  const secretEnc = encryptAtRest(secret);
  const expiresAt = new Date(Date.now() + TOTP_PENDING_TTL_MS);

  await prisma.userTwoFactorAuth.upsert({
    where: { userUuid: input.userUuid },
    create: {
      userUuid: input.userUuid,
      pendingEncryptedSecret: secretEnc,
      pendingExpiresAt: expiresAt,
    },
    update: {
      pendingEncryptedSecret: secretEnc,
      pendingExpiresAt: expiresAt,
    },
  });

  const otpauthUri = buildOtpAuthUri(input.email, secret);
  const qrCodeDataUrlValue = await qrCodeDataUrl(otpauthUri);
  const { challengeToken } = await createLoginChallenge({
    userUuid: input.userUuid,
    tenantUuid: input.tenantUuid,
    audience: input.audience,
    type: "TOTP_ENROLL",
  });

  return {
    challengeToken,
    qrCodeDataUrl: qrCodeDataUrlValue,
    manualEntryKey: secret,
  };
}

async function generateRecoveryCodes(userUuid: string) {
  await prisma.userRecoveryCode.deleteMany({ where: { userUuid } });
  const plainCodes: string[] = [];
  const rows = [];
  for (let i = 0; i < RECOVERY_CODE_COUNT; i++) {
    const code = randomToken(10).slice(0, 10).toUpperCase();
    plainCodes.push(code);
    rows.push({
      userUuid,
      codeHash: await hashPassword(code),
    });
  }
  await prisma.userRecoveryCode.createMany({ data: rows });
  return plainCodes;
}

export async function verifyTotpEnrollment(input: {
  challengeToken: string;
  code: string;
  correlationId?: string;
  issueSession?: boolean;
}) {
  const { challenge, account } = await loadChallenge(input.challengeToken);
  if (challenge.type !== "TOTP_ENROLL") {
    throw validationError("Invalid enrollment challenge");
  }

  const twoFa = await prisma.userTwoFactorAuth.findUnique({
    where: { userUuid: account.uuid },
  });
  if (
    !twoFa?.pendingEncryptedSecret ||
    !twoFa.pendingExpiresAt ||
    twoFa.pendingExpiresAt < new Date()
  ) {
    throw unauthenticated("Enrollment expired. Sign in again.");
  }

  const secret = decryptAtRest(twoFa.pendingEncryptedSecret);
  const valid = await verifyTotpCode(secret, input.code);
  if (!valid) {
    await incrementFailedAttempt(challenge.uuid);
    const attempt = await recordFailedAuthAttempt(account, "totp");
    await writeAuthAudit({
      action: "auth.2fa.enrollment.failed",
      actorUserUuid: account.uuid,
      tenantUuid: account.tenantUuid,
      correlationId: input.correlationId,
    });
    if (attempt.locked) {
      throw unauthenticated(accountLockedNotice(new Date(Date.now() + 15 * 60 * 1000)));
    }
    throw unauthenticated(failedAttemptNotice("totp", attempt.remaining));
  }

  await assertTotpNotReplayed(account.uuid, secret, input.code);
  await resetFailedTotpAttempts(account.uuid);

  await prisma.userTwoFactorAuth.update({
    where: { userUuid: account.uuid },
    data: {
      encryptedSecret: twoFa.pendingEncryptedSecret,
      pendingEncryptedSecret: null,
      pendingExpiresAt: null,
      enabledAt: new Date(),
    },
  });

  const recoveryCodes = await generateRecoveryCodes(account.uuid);
  await consumeChallenge(challenge.uuid);

  await writeAuthAudit({
    action: "auth.2fa.enrollment.success",
    actorUserUuid: account.uuid,
    tenantUuid: account.tenantUuid,
    correlationId: input.correlationId,
  });

  if (input.issueSession === false) {
    return {
      recoveryCodes,
      user: mapAuthUser(account),
      accessToken: null as string | null,
      refreshToken: null as string | null,
      audience: challenge.audience,
    };
  }

  const tokens = await createAuthenticatedSession({
    account,
    audience: challenge.audience,
  });
  return {
    ...tokens,
    recoveryCodes,
    user: mapAuthUser(account),
  };
}

export async function verifyLoginTotp(input: {
  challengeToken: string;
  code: string;
  correlationId?: string;
}) {
  const { challenge, account } = await loadChallenge(input.challengeToken);
  if (challenge.type !== "TOTP_VERIFY") {
    throw validationError("Invalid verification challenge");
  }
  if (!account.totpSecretEnc || !account.totpEnabledAt) {
    throw unauthenticated("Two-factor authentication is not enabled");
  }

  const secret = decryptAtRest(account.totpSecretEnc);
  const valid = await verifyTotpCode(secret, input.code);
  if (!valid) {
    await incrementFailedAttempt(challenge.uuid);
    const attempt = await recordFailedAuthAttempt(account, "totp");
    await writeAuthAudit({
      action: "auth.2fa.verify.failed",
      actorUserUuid: account.uuid,
      tenantUuid: account.tenantUuid,
      correlationId: input.correlationId,
    });
    if (attempt.locked) {
      throw unauthenticated(accountLockedNotice(new Date(Date.now() + 15 * 60 * 1000)));
    }
    throw unauthenticated(failedAttemptNotice("totp", attempt.remaining));
  }

  await assertTotpNotReplayed(account.uuid, secret, input.code);
  await resetFailedTotpAttempts(account.uuid);
  await consumeChallenge(challenge.uuid);
  await writeAuthAudit({
    action: "auth.2fa.verify.success",
    actorUserUuid: account.uuid,
    tenantUuid: account.tenantUuid,
    correlationId: input.correlationId,
  });

  const tokens = await createAuthenticatedSession({
    account,
    audience: challenge.audience,
  });
  return { ...tokens, user: mapAuthUser(account) };
}

export async function verifyRecoveryCode(input: {
  challengeToken: string;
  code: string;
  correlationId?: string;
}) {
  const { challenge, account } = await loadChallenge(input.challengeToken);
  if (challenge.type !== "TOTP_VERIFY" && challenge.type !== "RECOVERY") {
    throw validationError("Invalid recovery challenge");
  }

  const codes = await prisma.userRecoveryCode.findMany({
    where: { userUuid: account.uuid, usedAt: null },
  });

  let matchedId: string | null = null;
  for (const row of codes) {
    if (await verifyPassword(input.code.trim().toUpperCase(), row.codeHash)) {
      matchedId = row.uuid;
      break;
    }
  }

  if (!matchedId) {
    await incrementFailedAttempt(challenge.uuid);
    const attempt = await recordFailedAuthAttempt(account, "totp");
    await writeAuthAudit({
      action: "auth.2fa.recovery.failed",
      actorUserUuid: account.uuid,
      tenantUuid: account.tenantUuid,
      correlationId: input.correlationId,
    });
    if (attempt.locked) {
      throw unauthenticated(accountLockedNotice(new Date(Date.now() + 15 * 60 * 1000)));
    }
    throw unauthenticated(failedAttemptNotice("totp", attempt.remaining));
  }

  await prisma.userRecoveryCode.update({
    where: { uuid: matchedId },
    data: { usedAt: new Date() },
  });
  await resetFailedTotpAttempts(account.uuid);
  await consumeChallenge(challenge.uuid);

  await writeAuthAudit({
    action: "auth.2fa.recovery.success",
    actorUserUuid: account.uuid,
    tenantUuid: account.tenantUuid,
    correlationId: input.correlationId,
  });

  const tokens = await createAuthenticatedSession({
    account,
    audience: challenge.audience,
  });
  return { ...tokens, user: mapAuthUser(account) };
}
