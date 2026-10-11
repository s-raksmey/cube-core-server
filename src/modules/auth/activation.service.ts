import { AuthAudience, UserStatus, type AuthAudience as AuthAudienceType, type Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/src/lib/db";
import { managementAppBaseUrl } from "@/src/modules/tenants/tenant-domain.service";
import { ACTIVATION_TTL_MS } from "@/src/lib/auth/constants";
import { decryptAtRest, encryptAtRest, hashToken, randomToken } from "@/src/lib/auth/crypto";
import { verifyChallengeToken } from "@/src/lib/auth/session";
import {
  hashPassword,
  passwordPolicySchema,
} from "@/src/lib/auth/password";
import { forbidden, unauthenticated, validationError } from "@/src/lib/errors";
import { writeAuthAudit } from "@/src/modules/auth/audit-auth";
import { clearExpiredAccountLockout } from "@/src/modules/auth/lockout.service";
import { beginTotpEnrollment, verifyTotpEnrollment } from "@/src/modules/auth/totp.service";
import { displayFullName, findAccountByUuid } from "@/src/modules/users/account";

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

function activationUrl(
  baseUrl: string,
  token: string,
) {
  const url = new URL("/activate", `${baseUrl.replace(/\/$/, "")}/`);
  url.searchParams.set("token", token);
  return url.toString();
}

async function loadValidActivationToken(token: string) {
  const tokenHash = hashToken(token);
  let row = await prisma.userActivationToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (
    row?.user.status === UserStatus.LOCKED &&
    row.user.lockedUntil &&
    row.user.lockedUntil <= new Date()
  ) {
    await clearExpiredAccountLockout(row.userUuid);
    row = await prisma.userActivationToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
  }

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

export async function createActivationToken(
  input: {
  userUuid: string;
  createdByUuid: string;
  tenantUuid?: string;
  /** Defaults to ADMIN_CONSOLE (Main Console activate page). */
  audience?: AuthAudience;
  },
  transaction?: Prisma.TransactionClient,
) {
  const rawToken = randomToken(32);
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + ACTIVATION_TTL_MS);
  const audience = input.audience ?? AuthAudience.ADMIN_CONSOLE;
  let managementHostname: string | null = null;

  const persist = async (tx: Prisma.TransactionClient) => {
    await tx.userActivationToken.updateMany({
      where: {
        userUuid: input.userUuid,
        usedAt: null,
        revokedAt: null,
      },
      data: { revokedAt: new Date(), encryptedToken: null },
    });
    await tx.userActivationToken.create({
      data: {
        userUuid: input.userUuid,
        tokenHash,
        // Keep only an authenticated-encryption copy for the authorized
        // SuperAdmin link-view workflow. The lookup token remains hashed.
        encryptedToken: encryptAtRest(rawToken),
        expiresAt,
        createdByUuid: input.createdByUuid,
      },
    });
    if (audience === AuthAudience.TENANT_APP && input.tenantUuid) {
      const mapping = await tx.tenantDomain.findUnique({
        where: {
          tenantUuid_purpose: {
            tenantUuid: input.tenantUuid,
            purpose: "MANAGEMENT",
          },
        },
        select: { hostname: true, status: true },
      });
      managementHostname = mapping?.status === "ACTIVE" ? mapping.hostname : null;
    }
  };
  if (transaction) await persist(transaction);
  else await prisma.$transaction(persist);

  const fallbackBaseUrl = (
    audience === AuthAudience.TENANT_APP
      ? (process.env.TENANT_APP_URL ?? "http://localhost:3001")
      : (process.env.ADMIN_APP_URL ?? "http://localhost:3000")
  );
  const baseUrl = audience === AuthAudience.TENANT_APP
    ? managementAppBaseUrl(managementHostname, fallbackBaseUrl)
    : fallbackBaseUrl.replace(/\/$/, "");
  return {
    activationUrl: activationUrl(baseUrl, rawToken),
    expiresAt: expiresAt.toISOString(),
  };
}

export async function getExistingActivationLink(
  userUuid: string,
  options?: { audience?: AuthAudienceType; tenantUuid?: string },
) {
  const now = new Date();
  const row = await prisma.userActivationToken.findFirst({
    where: {
      userUuid,
      usedAt: null,
      revokedAt: null,
      expiresAt: { gt: now },
      encryptedToken: { not: null },
      user: {
        status: UserStatus.PENDING,
        deletedAt: null,
        ...(options?.tenantUuid
          ? {
              memberships: {
                some: {
                  tenantUuid: options.tenantUuid,
                  status: "ACTIVE",
                  role: { code: { in: ["ADMIN", "EDITOR"] } },
                  tenant: { type: "SUB", deletedAt: null },
                },
              },
            }
          : {}),
      },
    },
    orderBy: { createdAt: "desc" },
    select: { encryptedToken: true, expiresAt: true },
  });
  if (!row?.encryptedToken) return null;

  const audience = options?.audience ?? AuthAudience.ADMIN_CONSOLE;
  let managementHostname: string | null = null;
  if (audience === AuthAudience.TENANT_APP && options?.tenantUuid) {
    const mapping = await prisma.tenantDomain.findUnique({
      where: { tenantUuid_purpose: { tenantUuid: options.tenantUuid, purpose: "MANAGEMENT" } },
      select: { hostname: true, status: true },
    });
    managementHostname = mapping?.status === "ACTIVE" ? mapping.hostname : null;
  }
  const fallbackBaseUrl = audience === AuthAudience.TENANT_APP
    ? (process.env.TENANT_APP_URL ?? "http://localhost:3001")
    : (process.env.ADMIN_APP_URL ?? "http://localhost:3000");
  const baseUrl = audience === AuthAudience.TENANT_APP
    ? managementAppBaseUrl(managementHostname, fallbackBaseUrl)
    : fallbackBaseUrl.replace(/\/$/, "");
  const token = decryptAtRest(row.encryptedToken);
  return {
    activationUrl: activationUrl(baseUrl, token),
    expiresAt: row.expiresAt.toISOString(),
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
