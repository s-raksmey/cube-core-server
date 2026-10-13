import { prisma } from "@/src/lib/db";
import { PASSWORD_RESET_TTL_MS } from "@/src/lib/auth/constants";
import {
  decryptAtRest,
  encryptAtRest,
  hashToken,
  randomToken,
} from "@/src/lib/auth/crypto";

export async function findExistingPasswordResetToken(userUuid: string) {
  return prisma.userPasswordResetToken.findFirst({
    where: {
      userUuid,
      usedAt: null,
      revokedAt: null,
      expiresAt: { gt: new Date() },
      encryptedToken: { not: null },
    },
    orderBy: { createdAt: "desc" },
    select: { encryptedToken: true, expiresAt: true },
  });
}

export async function createPasswordResetToken(input: {
  userUuid: string;
  createdByUuid: string;
}) {
  const rawToken = randomToken(32);
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS);

  await prisma.$transaction([
    prisma.userPasswordResetToken.updateMany({
      where: { userUuid: input.userUuid, usedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
    prisma.userPasswordResetToken.create({
      data: {
        userUuid: input.userUuid,
        tokenHash,
        encryptedToken: encryptAtRest(rawToken),
        expiresAt,
        createdByUuid: input.createdByUuid,
      },
    }),
  ]);

  return { rawToken, expiresAt };
}

export async function findValidPasswordResetToken(token: string) {
  const row = await prisma.userPasswordResetToken.findUnique({
    where: { tokenHash: hashToken(token) },
  });
  if (!row || row.usedAt || row.revokedAt || row.expiresAt < new Date()) {
    return null;
  }
  return row;
}

export function decryptPasswordResetToken(token: string) {
  return decryptAtRest(token);
}

