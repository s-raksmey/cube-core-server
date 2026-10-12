import { beforeEach, describe, expect, it, vi } from "vitest";
import { UserStatus } from "@prisma/client";
import type { SessionPayload } from "@/src/lib/auth/session";

const mocks = vi.hoisted(() => {
  const tx = {
    $queryRaw: vi.fn(),
    tenantMembership: { findFirst: vi.fn() },
    user: { update: vi.fn() },
    userTwoFactorAuth: { updateMany: vi.fn() },
    authLoginChallenge: { updateMany: vi.fn() },
    userRecoveryCode: { deleteMany: vi.fn() },
    userPasswordResetToken: { updateMany: vi.fn() },
    userSession: { updateMany: vi.fn() },
  };
  let transactionTail: Promise<unknown> = Promise.resolve();
  const prisma = {
    tenant: { findFirst: vi.fn() },
    tenantMembership: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
    },
    $transaction: vi.fn((callback: (client: typeof tx) => Promise<unknown>) => {
      const next = transactionTail.then(() => callback(tx));
      transactionTail = next.catch(() => undefined);
      return next;
    }),
    resetTransactions: () => { transactionTail = Promise.resolve(); },
    tx,
    createActivationToken: vi.fn(),
    getExistingActivationLink: vi.fn(),
    writeAuthAudit: vi.fn(),
    findAccountByUuid: vi.fn(),
    getMainTenant: vi.fn(),
    mapAuthUser: vi.fn(),
    displayFullName: vi.fn(),
    requireTenantUserPermission: vi.fn(),
  };
  return prisma;
});

vi.mock("@/src/lib/db", () => ({ prisma: mocks }));
vi.mock("@/src/modules/auth/activation.service", () => ({
  createActivationToken: mocks.createActivationToken,
  getExistingActivationLink: mocks.getExistingActivationLink,
}));
vi.mock("@/src/modules/auth/audit-auth", () => ({ writeAuthAudit: mocks.writeAuthAudit }));
vi.mock("@/src/modules/roles/role-permission.service", () => ({
  requireTenantUserPermission: mocks.requireTenantUserPermission,
}));
vi.mock("@/src/modules/users/account", () => ({
  displayFullName: mocks.displayFullName,
  getMainTenant: mocks.getMainTenant,
  getRoleUuid: vi.fn(),
  mapAuthUser: mocks.mapAuthUser,
  findAccountByUuid: mocks.findAccountByUuid,
}));

import {
  getSubTenantUserActivationLink,
  listManagedSubTenantUsers,
  regenerateSubTenantUserActivationLink,
} from "@/src/modules/tenants/tenant.service";

const superAdminSession = {
  userId: "11111111-1111-4111-8111-111111111111",
  tenantId: "22222222-2222-4222-8222-222222222222",
  role: "SUPERADMIN",
} as SessionPayload;
const tenantId = "33333333-3333-4333-8333-333333333333";
const userId = "44444444-4444-4444-8444-444444444444";

beforeEach(() => {
  mocks.tenant.findFirst.mockReset().mockResolvedValue({ uuid: tenantId });
  mocks.tenantMembership.findMany.mockReset().mockResolvedValue([]);
  mocks.tenantMembership.findFirst.mockReset();
  mocks.tenantMembership.count.mockReset().mockResolvedValue(0);
  mocks.tx.tenantMembership.findFirst.mockReset();
  mocks.tx.user.update.mockReset().mockResolvedValue(undefined);
  mocks.tx.userTwoFactorAuth.updateMany.mockReset().mockResolvedValue(undefined);
  mocks.tx.authLoginChallenge.updateMany.mockReset().mockResolvedValue(undefined);
  mocks.tx.userRecoveryCode.deleteMany.mockReset().mockResolvedValue(undefined);
  mocks.tx.userPasswordResetToken.updateMany.mockReset().mockResolvedValue(undefined);
  mocks.tx.userSession.updateMany.mockReset().mockResolvedValue(undefined);
  mocks.tx.$queryRaw.mockReset().mockResolvedValue([]);
  mocks.resetTransactions();
  mocks.createActivationToken.mockReset();
  mocks.getExistingActivationLink.mockReset();
  mocks.writeAuthAudit.mockReset().mockResolvedValue(undefined);
  mocks.findAccountByUuid.mockReset().mockResolvedValue({ uuid: userId });
  mocks.getMainTenant.mockReset().mockResolvedValue({ uuid: superAdminSession.tenantId });
  mocks.mapAuthUser.mockReset().mockReturnValue({ id: userId });
  mocks.displayFullName.mockReset().mockImplementation((user: { firstName?: string; lastName?: string }) => `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim());
  mocks.requireTenantUserPermission.mockReset().mockResolvedValue(undefined);
});

describe("Main Console tenant user activation management", () => {
  it("rejects non-SuperAdmin access before reading tenant data", async () => {
    await expect(listManagedSubTenantUsers(
      { ...superAdminSession, role: "ADMIN" } as SessionPayload,
      { tenantId },
    )).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
    expect(mocks.tenant.findFirst).not.toHaveBeenCalled();
  });

  it("rejects SuperAdmin requests made with a non-MAIN tenant session", async () => {
    mocks.getMainTenant.mockResolvedValue({ uuid: "55555555-5555-4555-8555-555555555555" });
    await expect(listManagedSubTenantUsers(superAdminSession, { tenantId }))
      .rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
    expect(mocks.tenant.findFirst).not.toHaveBeenCalled();
  });

  it("enforces the SuperAdmin View users policy before loading a sub-tenant roster", async () => {
    mocks.requireTenantUserPermission.mockRejectedValueOnce({
      extensions: { code: "FORBIDDEN" },
    });
    await expect(listManagedSubTenantUsers(superAdminSession, { tenantId }))
      .rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
    expect(mocks.tenant.findFirst).not.toHaveBeenCalled();
  });

  it("accepts a null GraphQL search value as no filter", async () => {
    await expect(listManagedSubTenantUsers(superAdminSession, { tenantId, search: null }))
      .resolves.toMatchObject({ items: [], total: 0 });
    expect(mocks.tenantMembership.findMany.mock.calls[0]?.[0].where.user)
      .toEqual({ deletedAt: null });
    expect(mocks.requireTenantUserPermission).toHaveBeenCalledWith(
      superAdminSession,
      "USERS_VIEW",
    );
  });

  it("derives expired link status without treating the pending account as expired", async () => {
    const now = new Date();
    const createdAt = new Date(now.getTime() - 30 * 60_000);
    const expiresAt = new Date(now.getTime() - 60_000);
    mocks.tenantMembership.findMany.mockResolvedValue([{
      role: { code: "ADMIN" },
      user: {
        uuid: userId,
        email: "pending@example.com",
        firstName: "Pending",
        lastName: "User",
        status: UserStatus.PENDING,
        activatedAt: null,
        activationTokens: [{ createdAt, expiresAt, usedAt: null, revokedAt: null }],
      },
    }]);

    const result = await listManagedSubTenantUsers(superAdminSession, { tenantId });

    expect(result.items[0]).toMatchObject({
      accountStatus: "PENDING",
      activationStatus: "EXPIRED",
      activationLinkCreatedAt: createdAt.toISOString(),
      activationLinkExpiresAt: expiresAt.toISOString(),
    });
    expect(mocks.tenantMembership.findMany.mock.calls[0]?.[0].select.user.select)
      .not.toHaveProperty("passwordHash");
  });

  it.each([
    [UserStatus.ACTIVE, new Date(), "ACTIVE"],
    [UserStatus.INACTIVE, null, "DISABLED"],
  ] as const)("reports %s user state as %s", async (status, activatedAt, expected) => {
    mocks.tenantMembership.findMany.mockResolvedValue([{
      role: { code: "EDITOR" },
      user: {
        uuid: userId,
        email: "user@example.com",
        firstName: "Tenant",
        lastName: "User",
        status,
        activatedAt,
        activationTokens: [],
      },
    }]);
    const result = await listManagedSubTenantUsers(superAdminSession, { tenantId });
    expect(result.items[0]?.activationStatus).toBe(expected);
  });

  it("regenerates and audits a tenant-scoped pending activation link", async () => {
    const activation = { activationUrl: "https://tenant.example/activate?token=one-time", expiresAt: new Date(Date.now() + 60_000).toISOString() };
    mocks.tx.tenantMembership.findFirst.mockResolvedValue({
      user: { uuid: userId, status: UserStatus.PENDING, activatedAt: null },
    });
    mocks.createActivationToken.mockResolvedValue(activation);

    await expect(regenerateSubTenantUserActivationLink(superAdminSession, tenantId, userId))
      .resolves.toMatchObject(activation);

    expect(mocks.tx.$queryRaw).toHaveBeenCalledOnce();
    expect(mocks.tx.tenantMembership.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ tenantUuid: tenantId, userUuid: userId }),
    }));
    expect(mocks.createActivationToken).toHaveBeenCalledWith(expect.objectContaining({
      userUuid: userId,
      tenantUuid: tenantId,
      audience: "TENANT_APP",
    }), mocks.tx);
    expect(mocks.writeAuthAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "auth.activation.link_regenerated",
      targetUuid: userId,
      metadata: { audience: "TENANT_APP" },
    }), mocks.tx);
  });

  it("returns the existing tenant link only for an authorized pending member", async () => {
    const link = {
      activationUrl: "http://localhost:3001/activate?token=one-time",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
    mocks.tenantMembership.findFirst.mockResolvedValue({ userUuid: userId });
    mocks.getExistingActivationLink.mockResolvedValue(link);

    await expect(getSubTenantUserActivationLink(superAdminSession, tenantId, userId))
      .resolves.toEqual(link);
    expect(mocks.getExistingActivationLink).toHaveBeenCalledWith(userId, {
      audience: "TENANT_APP",
      tenantUuid: tenantId,
    });
    expect(mocks.writeAuthAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "auth.activation.link_viewed",
      tenantUuid: tenantId,
      targetUuid: userId,
      metadata: { audience: "TENANT_APP" },
    }));
  });

  it("allows an Editor with Activate users permission to view and regenerate a pending link", async () => {
    const editorSession = {
      ...superAdminSession,
      tenantId,
      role: "EDITOR",
      audience: "TENANT_APP",
    } as SessionPayload;
    const link = {
      activationUrl: "http://localhost:3001/activate?token=one-time",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
    mocks.tenantMembership.findFirst.mockResolvedValue({ userUuid: userId });
    mocks.getExistingActivationLink.mockResolvedValue(link);
    mocks.tx.tenantMembership.findFirst.mockResolvedValue({
      user: { uuid: userId, status: UserStatus.PENDING, activatedAt: null },
    });
    mocks.createActivationToken.mockResolvedValue(link);

    await expect(getSubTenantUserActivationLink(editorSession, tenantId, userId))
      .resolves.toEqual(link);
    await expect(regenerateSubTenantUserActivationLink(editorSession, tenantId, userId))
      .resolves.toMatchObject(link);
    expect(mocks.requireTenantUserPermission).toHaveBeenCalledWith(
      editorSession,
      "USERS_ACTIVATE",
    );
  });

  it("rejects cross-tenant memberships", async () => {
    mocks.tx.tenantMembership.findFirst.mockResolvedValue(null);
    await expect(regenerateSubTenantUserActivationLink(superAdminSession, tenantId, userId))
      .rejects.toMatchObject({ extensions: { code: "VALIDATION" } });
    expect(mocks.createActivationToken).not.toHaveBeenCalled();
  });

  it("reactivates an active account by clearing its sign-in credentials and 2FA setup", async () => {
    mocks.tx.tenantMembership.findFirst.mockResolvedValue({
      user: { uuid: userId, status: UserStatus.ACTIVE, activatedAt: new Date() },
    });
    mocks.createActivationToken.mockResolvedValue({
      activationUrl: "https://tenant.example/activate?token=reissued",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    await expect(regenerateSubTenantUserActivationLink(superAdminSession, tenantId, userId))
      .resolves.toMatchObject({ activationUrl: expect.stringContaining("reissued") });
    expect(mocks.tx.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { uuid: userId },
      data: expect.objectContaining({ status: UserStatus.PENDING, passwordHash: null }),
    }));
    expect(mocks.tx.userTwoFactorAuth.updateMany).toHaveBeenCalledOnce();
    expect(mocks.writeAuthAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "auth.account.reactivated",
    }), mocks.tx);
  });

  it("rejects link regeneration for inactive accounts", async () => {
    mocks.tx.tenantMembership.findFirst.mockResolvedValue({
      user: { uuid: userId, status: UserStatus.INACTIVE, activatedAt: null },
    });
    await expect(regenerateSubTenantUserActivationLink(superAdminSession, tenantId, userId))
      .rejects.toMatchObject({ extensions: { code: "VALIDATION" } });
    expect(mocks.createActivationToken).not.toHaveBeenCalled();
  });

  it("serializes concurrent regenerations so only the latest generated link remains valid", async () => {
    const generated: { url: string; revoked: boolean }[] = [];
    mocks.tx.tenantMembership.findFirst.mockResolvedValue({
      user: { uuid: userId, status: UserStatus.PENDING, activatedAt: null },
    });
    mocks.createActivationToken.mockImplementation(async () => {
      for (const token of generated) token.revoked = true;
      const next = { url: `token-${generated.length + 1}`, revoked: false };
      generated.push(next);
      return { activationUrl: next.url, expiresAt: new Date(Date.now() + 60_000).toISOString() };
    });

    await Promise.all([
      regenerateSubTenantUserActivationLink(superAdminSession, tenantId, userId),
      regenerateSubTenantUserActivationLink(superAdminSession, tenantId, userId),
    ]);

    expect(generated.filter((token) => !token.revoked)).toHaveLength(1);
    expect(mocks.tx.$queryRaw).toHaveBeenCalledTimes(2);
  });
});
