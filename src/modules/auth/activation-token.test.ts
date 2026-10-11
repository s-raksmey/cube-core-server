import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthAudience } from "@prisma/client";
import { decryptAtRest } from "@/src/lib/auth/crypto";

const mocks = vi.hoisted(() => ({
  updateMany: vi.fn(),
  create: vi.fn(),
  domainFindUnique: vi.fn(),
}));
vi.mock("@/src/lib/db", () => ({
  prisma: {
    userActivationToken: { updateMany: mocks.updateMany, create: mocks.create },
    tenantDomain: { findUnique: mocks.domainFindUnique },
  },
}));

import { createActivationToken } from "@/src/modules/auth/activation.service";

beforeEach(() => {
  mocks.updateMany.mockReset().mockResolvedValue({ count: 1 });
  mocks.create.mockReset().mockImplementation(async ({ data }) => data);
  mocks.domainFindUnique.mockReset().mockResolvedValue({ hostname: null, status: "DISABLED" });
});

describe("activation token persistence", () => {
  it("revokes previous unused links, stores a hash and encrypted recoverable token, and bounds expiry", async () => {
    const tx = {
      userActivationToken: { updateMany: mocks.updateMany, create: mocks.create },
      tenantDomain: { findUnique: mocks.domainFindUnique },
    } as never;
    const before = Date.now();

    const result = await createActivationToken({
      userUuid: "user-uuid",
      createdByUuid: "actor-uuid",
      tenantUuid: "11111111-1111-4111-8111-111111111111",
      audience: AuthAudience.TENANT_APP,
    }, tx);

    const rawToken = new URL(result.activationUrl).searchParams.get("token");
    const stored = mocks.create.mock.calls[0]?.[0].data as {
      tokenHash: string;
      encryptedToken: string | null;
      expiresAt: Date;
    };
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userUuid: "user-uuid", usedAt: null, revokedAt: null },
      data: expect.objectContaining({ revokedAt: expect.any(Date), encryptedToken: null }),
    }));
    expect(rawToken).toBeTruthy();
    expect(stored.tokenHash).not.toBe(rawToken);
    expect(stored.encryptedToken).toBeTruthy();
    expect(decryptAtRest(stored.encryptedToken!)).toBe(rawToken);
    expect(stored.expiresAt.getTime()).toBeGreaterThan(before);
    expect(stored.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
    expect(JSON.stringify(stored)).not.toContain(rawToken);
  });
});
