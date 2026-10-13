import { AuthAudience, UserStatus, type AuthAudience as AuthAudienceType, type Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/src/lib/db";
import { verifyChallengeToken } from "@/src/lib/auth/session";
import {
  hashPassword,
  passwordPolicySchema,
} from "@/src/lib/auth/password";
import { forbidden, unauthenticated, validationError } from "@/src/lib/errors";
import { writeAuthAudit } from "@/src/modules/auth/audit-auth";
import { beginTotpEnrollment, verifyTotpEnrollment } from "@/src/modules/auth/totp.service";
import { displayFullName, findAccountByUuid } from "@/src/modules/users/account";
import { loadValidActivationToken } from "@/src/modules/auth/activation-token.service";

export {
  createActivationToken,
  getExistingActivationLink,
  validateActivationToken,
} from "@/src/modules/auth/activation-token.service";

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

/** Step 1: username + password. Token stays open until 2FA completes. */
export async function completeActivationCredentials(input: {
  token: string;
  username: string;
  password: string;
  confirmPassword: string;
  trustedAudience: AuthAudienceType;
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

  const account = await findAccountByUuid(row.userUuid);
  if (!account) throw validationError("User membership not found");
  const audience =
    account.roleCode === "SUPERADMIN"
      ? AuthAudience.ADMIN_CONSOLE
      : AuthAudience.TENANT_APP;
  if (input.trustedAudience !== audience) {
    throw forbidden("This activation link must be completed in its assigned application");
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
  };
}

/** Step 2: verify TOTP, consume activation token, mark ACTIVE, return recovery codes. */
export async function completeActivationTotp(input: {
  challengeToken: string;
  code: string;
  correlationId?: string;
}) {
  let challengePayload;
  try {
    challengePayload = await verifyChallengeToken(input.challengeToken);
  } catch {
    throw unauthenticated("Enrollment expired. Start activation again.");
  }
  if (
    challengePayload.type !== "TOTP_ENROLL" ||
    !Object.values(AuthAudience).includes(challengePayload.audience)
  ) {
    throw unauthenticated("Invalid activation challenge");
  }
  const row = await prisma.userActivationToken.findFirst({
    where: {
      userUuid: challengePayload.userId,
      usedAt: null,
      revokedAt: null,
      expiresAt: { gt: new Date() },
      user: { deletedAt: null, status: UserStatus.PENDING },
    },
    orderBy: { createdAt: "desc" },
  });
  if (!row) throw unauthenticated("Invalid or expired activation link");

  const result = await verifyTotpEnrollment({
    challengeToken: input.challengeToken,
    code: input.code,
    correlationId: input.correlationId,
    issueSession: false,
    onEnrollmentVerified: async (tx: Prisma.TransactionClient) => {
      const now = new Date();
      const mark = await tx.userActivationToken.updateMany({
        where: {
          uuid: row.uuid,
          usedAt: null,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        data: { usedAt: now, encryptedToken: null },
      });
      if (mark.count !== 1) throw unauthenticated("Activation link already used");

      const activated = await tx.user.updateMany({
        where: {
          uuid: row.userUuid,
          status: UserStatus.PENDING,
          activatedAt: null,
        },
        data: { status: UserStatus.ACTIVE, activatedAt: now },
      });
      if (activated.count !== 1) {
        throw unauthenticated("Account activation is no longer available");
      }

      await tx.userActivationToken.updateMany({
        where: {
          userUuid: row.userUuid,
          usedAt: null,
          revokedAt: null,
          uuid: { not: row.uuid },
        },
        data: { revokedAt: now, encryptedToken: null },
      });
    },
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
