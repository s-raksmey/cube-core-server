import {
  AuthAudience,
  UserStatus,
  type AuthAudience as AuthAudienceType,
  type Prisma,
} from "@prisma/client";
import { prisma } from "@/src/lib/db";
import { managementAppBaseUrl } from "@/src/modules/tenants/tenant-domain.service";
import { ACTIVATION_TTL_MS } from "@/src/lib/auth/constants";
import {
  decryptAtRest,
  encryptAtRest,
  hashToken,
  randomToken,
} from "@/src/lib/auth/crypto";
import { unauthenticated } from "@/src/lib/errors";
import { clearExpiredAccountLockout } from "@/src/modules/auth/lockout.service";
function activationUrl(
  baseUrl: string,
  token: string,
) {
  const url = new URL("/activate", `${baseUrl.replace(/\/$/, "")}/`);
  url.searchParams.set("token", token);
  return url.toString();
}

export async function loadValidActivationToken(token: string) {
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

