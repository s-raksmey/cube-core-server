import { AuthAudience, UserStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/src/lib/db";
import { ACTIVATION_TTL_MS } from "@/src/lib/auth/constants";
import { hashToken, randomToken } from "@/src/lib/auth/crypto";
import {
  hashPassword,
  passwordPolicySchema,
} from "@/src/lib/auth/password";
import { unauthenticated, validationError } from "@/src/lib/errors";
import { writeAuthAudit } from "@/src/services/account/audit-auth";
import { beginTotpEnrollment, verifyTotpEnrollment } from "@/src/services/account/totp.service";
import { displayFullName, findAccountByUuid } from "@/src/services/user/account";

const usernameSchema = z
  .string()
  .trim()
  .min(2)
  .max(40)
  .regex(
    /^[a-zA-Z0-9._-]+$/,
    "Username may only contain letters, numbers, dots, underscores, and hyphens",
  );

const credentialsSchema = z.object({
  token: z.string().min(1),
  username: usernameSchema,
  password: passwordPolicySchema,
  confirmPassword: z.string().min(1),
});

async function loadValidActivationToken(token: string) {
  const tokenHash = hashToken(token);
  const row = await prisma.userActivationToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (
    !row ||
    row.usedAt ||
    row.revokedAt ||
    row.expiresAt < new Date() ||
    row.user.deletedAt
  ) {
    throw unauthenticated("Invalid or expired activation link");
  }

  if (
    row.user.status !== UserStatus.PENDING &&
    row.user.status !== UserStatus.ACTIVE
  ) {
    throw unauthenticated("Invalid or expired activation link");
  }

  return row;
}

export async function createActivationToken(input: {
  userUuid: string;
  createdByUuid: string;
  /** Defaults to ADMIN_CONSOLE (Main Console activate page). */
  audience?: AuthAudience;
}) {
  const rawToken = randomToken(32);
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + ACTIVATION_TTL_MS);

  await prisma.$transaction([
    prisma.userActivationToken.updateMany({
      where: {
        userUuid: input.userUuid,
        usedAt: null,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    }),
    prisma.userActivationToken.create({
      data: {
        userUuid: input.userUuid,
        tokenHash,
        expiresAt,
        createdByUuid: input.createdByUuid,
      },
    }),
  ]);

  const audience = input.audience ?? AuthAudience.ADMIN_CONSOLE;
  const baseUrl = (
    audience === AuthAudience.TENANT_APP
      ? (process.env.TENANT_APP_URL ?? "http://localhost:3001")
      : (process.env.ADMIN_APP_URL ?? "http://localhost:3000")
  ).replace(/\/$/, "");
  return {
    activationUrl: `${baseUrl}/activate?token=${encodeURIComponent(rawToken)}`,
    expiresAt: expiresAt.toISOString(),
  };
}

export async function validateActivationToken(token: string) {
  const row = await loadValidActivationToken(token);
  return {
    valid: true as const,
    expiresAt: row.expiresAt.toISOString(),
    email: row.user.email,
    firstName: row.user.firstName,
    lastName: row.user.lastName,
    needsActivation: !row.user.activatedAt,
  };
}

/** Step 1: username + password. Token stays open until 2FA completes. */
export async function completeActivationCredentials(input: {
  token: string;
  username: string;
  password: string;
  confirmPassword: string;
  correlationId?: string;
}) {
  const parsed = credentialsSchema.safeParse(input);
  if (!parsed.success) {
    throw validationError(parsed.error.issues[0]?.message ?? "Invalid input");
  }
  if (parsed.data.password !== parsed.data.confirmPassword) {
    throw validationError("Passwords do not match");
  }

  const row = await loadValidActivationToken(parsed.data.token);
  if (row.user.activatedAt && row.user.status === UserStatus.ACTIVE) {
    const twoFa = await prisma.userTwoFactorAuth.findUnique({
      where: { userUuid: row.userUuid },
    });
    if (twoFa?.enabledAt) {
      throw validationError(
        "This account is already activated. Use a password reset link instead.",
      );
    }
  }

  const username = parsed.data.username.toLowerCase();
  const taken = await prisma.user.findFirst({
    where: {
      username: { equals: username, mode: "insensitive" },
      uuid: { not: row.userUuid },
    },
  });
  if (taken) throw validationError("Username already taken");

  const passwordHash = await hashPassword(parsed.data.password);
  await prisma.user.update({
    where: { uuid: row.userUuid },
    data: { username, passwordHash },
  });

  const account = await findAccountByUuid(row.userUuid);
  if (!account) throw validationError("User membership not found");

  const audience =
    account.roleCode === "SUPERADMIN"
      ? AuthAudience.ADMIN_CONSOLE
      : AuthAudience.TENANT_APP;

  const enrollment = await beginTotpEnrollment({
    userUuid: account.uuid,
    tenantUuid: account.tenantUuid,
    email: account.email,
    audience,
  });

  await writeAuthAudit({
    action: "auth.activation.credentials_set",
    actorUserUuid: account.uuid,
    tenantUuid: account.tenantUuid,
    correlationId: input.correlationId,
    metadata: {
      userUuid: account.uuid,
      username,
      fullName: displayFullName(account),
    },
  });

  return {
    nextStep: "TOTP_ENROLL" as const,
    challengeToken: enrollment.challengeToken,
    qrCodeDataUrl: enrollment.qrCodeDataUrl,
    manualEntryKey: enrollment.manualEntryKey,
    email: account.email,
    username,
    activationToken: parsed.data.token,
  };
}

/** Step 2: verify TOTP, consume activation token, mark ACTIVE, return recovery codes. */
export async function completeActivationTotp(input: {
  challengeToken: string;
  code: string;
  activationToken: string;
  correlationId?: string;
}) {
  const row = await loadValidActivationToken(input.activationToken);

  const result = await verifyTotpEnrollment({
    challengeToken: input.challengeToken,
    code: input.code,
    correlationId: input.correlationId,
    issueSession: false,
  });

  await prisma.$transaction(async (tx) => {
    const mark = await tx.userActivationToken.updateMany({
      where: { uuid: row.uuid, usedAt: null, revokedAt: null },
      data: { usedAt: new Date() },
    });
    if (mark.count !== 1) {
      throw unauthenticated("Activation link already used");
    }

    await tx.user.update({
      where: { uuid: row.userUuid },
      data: {
        status: UserStatus.ACTIVE,
        activatedAt: new Date(),
      },
    });

    await tx.userActivationToken.updateMany({
      where: {
        userUuid: row.userUuid,
        usedAt: null,
        revokedAt: null,
        uuid: { not: row.uuid },
      },
      data: { revokedAt: new Date() },
    });
  });

  await writeAuthAudit({
    action: "auth.activation.completed",
    actorUserUuid: row.userUuid,
    tenantUuid: result.user.tenantId,
    correlationId: input.correlationId,
    metadata: { userUuid: row.userUuid },
  });

  return {
    success: true as const,
    recoveryCodes: result.recoveryCodes,
    user: result.user,
  };
}
