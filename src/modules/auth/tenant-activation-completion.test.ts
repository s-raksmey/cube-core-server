import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthAudience, UserStatus } from "@prisma/client";

const mocks = vi.hoisted(() => {
  const tx = {
    authLoginChallenge: { updateMany: vi.fn() },
    userTwoFactorAuth: { update: vi.fn() },
    userRecoveryCode: { deleteMany: vi.fn(), createMany: vi.fn() },
    userActivationToken: { updateMany: vi.fn() },
    user: { updateMany: vi.fn() },
  };
  return {
    tx,
    activationFindFirst: vi.fn(),
    verifyChallengeToken: vi.fn(),
    verifyTotpEnrollment: vi.fn(),
    writeAuthAudit: vi.fn(),
  };
});

vi.mock("@/src/lib/db", () => ({
  prisma: { userActivationToken: { findFirst: mocks.activationFindFirst } },
}));
vi.mock("@/src/lib/auth/session", () => ({ verifyChallengeToken: mocks.verifyChallengeToken }));
vi.mock("@/src/modules/auth/totp.service", () => ({
  beginTotpEnrollment: vi.fn(),
  verifyTotpEnrollment: mocks.verifyTotpEnrollment,
}));
vi.mock("@/src/modules/auth/audit-auth", () => ({ writeAuthAudit: mocks.writeAuthAudit }));
vi.mock("@/src/modules/auth/lockout.service", () => ({ clearExpiredAccountLockout: vi.fn() }));
vi.mock("@/src/modules/users/account", () => ({ displayFullName: vi.fn(), findAccountByUuid: vi.fn() }));

import { completeActivationTotp } from "@/src/modules/auth/activation.service";

beforeEach(() => {
  mocks.activationFindFirst.mockReset().mockResolvedValue({
    uuid: "activation-token",
    userUuid: "user-uuid",
  });
  mocks.verifyChallengeToken.mockReset().mockResolvedValue({
    type: "TOTP_ENROLL",
    audience: AuthAudience.TENANT_APP,
    userId: "user-uuid",
  });
  for (const model of Object.values(mocks.tx)) {
    for (const method of Object.values(model)) {
      (method as ReturnType<typeof vi.fn>).mockReset().mockResolvedValue({ count: 1 });
    }
  }
  mocks.verifyTotpEnrollment.mockReset().mockImplementation(async (input) => {
    await input.onEnrollmentVerified(mocks.tx);
    return { recoveryCodes: ["recovery-once"], user: { id: "user-uuid", tenantId: "tenant-uuid" } };
  });
  mocks.writeAuthAudit.mockReset().mockResolvedValue(undefined);
});

describe("tenant account activation completion", () => {
  it("completes tenant TOTP enrollment, consumes the link, and activates the account", async () => {
    const result = await completeActivationTotp({ challengeToken: "signed-challenge", code: "123456" });

    expect(result).toMatchObject({ success: true, recoveryCodes: ["recovery-once"] });
    expect(mocks.activationFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ user: { deletedAt: null, status: UserStatus.PENDING } }),
    }));
    expect(mocks.tx.userActivationToken.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ uuid: "activation-token", usedAt: null }),
      data: expect.objectContaining({ usedAt: expect.any(Date), encryptedToken: null }),
    }));
    expect(mocks.tx.user.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { uuid: "user-uuid", status: UserStatus.PENDING, activatedAt: null },
      data: expect.objectContaining({ status: UserStatus.ACTIVE, activatedAt: expect.any(Date) }),
    }));
    expect(mocks.writeAuthAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "auth.activation.completed",
      actorUserUuid: "user-uuid",
    }));
  });
});
