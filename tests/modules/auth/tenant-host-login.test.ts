import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TenantDomainPurpose } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  findActiveTenantByHostname: vi.fn(),
  findLocalDevelopmentTenant: vi.fn(),
  findAccountByEmailOrUsername: vi.fn(),
  assertConsoleAuthorization: vi.fn(),
  verifyPassword: vi.fn(),
  beginTotpEnrollment: vi.fn(),
  createLoginChallenge: vi.fn(),
  writeAuthAudit: vi.fn(),
  clearExpiredAccountLockout: vi.fn(),
  accountLockedNotice: vi.fn(),
  accountStatusLoginNotice: vi.fn(),
  failedAttemptNotice: vi.fn(),
  recordFailedAuthAttempt: vi.fn(),
  resetFailedPasswordAttempts: vi.fn(),
}));

vi.mock("@/src/modules/tenants/tenant-domain.service", () => ({
  findActiveTenantByHostname: mocks.findActiveTenantByHostname,
}));
vi.mock("@/src/modules/tenants/local-development-tenant.service", () => ({
  findLocalDevelopmentTenant: mocks.findLocalDevelopmentTenant,
}));
vi.mock("@/src/modules/users/account", () => ({
  assertConsoleAuthorization: mocks.assertConsoleAuthorization,
  findAccountByEmailOrUsername: mocks.findAccountByEmailOrUsername,
  findAccountByUuid: vi.fn(),
  mapAuthUser: vi.fn(),
}));
vi.mock("@/src/lib/auth/password", () => ({ verifyPassword: mocks.verifyPassword }));
vi.mock("@/src/modules/auth/audit-auth", () => ({
  writeAuthAudit: mocks.writeAuthAudit,
}));
vi.mock("@/src/modules/auth/totp.service", () => ({
  beginTotpEnrollment: mocks.beginTotpEnrollment,
  createLoginChallenge: mocks.createLoginChallenge,
}));
vi.mock("@/src/modules/auth/lockout.service", () => ({
  accountLockedNotice: mocks.accountLockedNotice,
  accountStatusLoginNotice: mocks.accountStatusLoginNotice,
  clearExpiredAccountLockout: mocks.clearExpiredAccountLockout,
  failedAttemptNotice: mocks.failedAttemptNotice,
  INVALID_PASSWORD_LOGIN_NOTICE: "Invalid username/email or password",
  recordFailedAuthAttempt: mocks.recordFailedAuthAttempt,
  resetFailedPasswordAttempts: mocks.resetFailedPasswordAttempts,
}));

import { loginWithPassword } from "@/src/modules/auth/auth.service";

const tenantAccount = {
  uuid: "user-1",
  email: "user@example.com",
  username: "tenant-user",
  firstName: "Tenant",
  lastName: "User",
  fullName: "Tenant User",
  passwordHash: "password-hash",
  status: "ACTIVE",
  tenantUuid: "tenant-1",
  roleCode: "ADMIN",
  membershipUuid: "membership-1",
  totpSecretEnc: "encrypted-totp",
  totpEnabledAt: new Date(),
  sessionsRevokedAt: null,
  lockedUntil: null,
  tenant: {
    uuid: "tenant-1",
    name: "Tenant One",
    slug: "tenant-one",
    type: "SUB",
    status: "ACTIVE",
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findActiveTenantByHostname.mockResolvedValue({ uuid: "tenant-1" });
  mocks.findLocalDevelopmentTenant.mockResolvedValue({ uuid: "tenant-1" });
  mocks.findAccountByEmailOrUsername.mockResolvedValue(tenantAccount);
  mocks.verifyPassword.mockResolvedValue(true);
  mocks.createLoginChallenge.mockResolvedValue({ challengeToken: "challenge" });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("tenant hostname login binding", () => {
  it("looks up only the membership for the tenant mapped to the management hostname", async () => {
    await loginWithPassword(
      "USER@example.com",
      "correct-password",
      "TENANT_APP",
      undefined,
      "TENANT.example.com",
    );

    expect(mocks.findActiveTenantByHostname).toHaveBeenCalledWith(
      "TENANT.example.com",
      TenantDomainPurpose.MANAGEMENT,
    );
    expect(mocks.findAccountByEmailOrUsername).toHaveBeenCalledWith(
      "user@example.com",
      "tenant-1",
    );
  });

  it("binds localhost login to the single server-managed local tenant", async () => {
    await loginWithPassword(
      "USER@example.com",
      "correct-password",
      "TENANT_APP",
      undefined,
      "localhost",
    );

    expect(mocks.findLocalDevelopmentTenant).toHaveBeenCalledOnce();
    expect(mocks.findAccountByEmailOrUsername).toHaveBeenCalledWith(
      "user@example.com",
      "tenant-1",
    );
    expect(mocks.findActiveTenantByHostname).not.toHaveBeenCalled();
  });

  it("rejects localhost login when no local tenant is assigned", async () => {
    mocks.findLocalDevelopmentTenant.mockResolvedValue(null);
    await expect(
      loginWithPassword(
        "user@example.com",
        "correct-password",
        "TENANT_APP",
        undefined,
        "localhost",
      ),
    ).rejects.toThrow("This tenant console address is unavailable");
    expect(mocks.findAccountByEmailOrUsername).not.toHaveBeenCalled();
  });

  it("does not allow localhost to override production domain routing", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(
      loginWithPassword(
        "user@example.com",
        "correct-password",
        "TENANT_APP",
        undefined,
        "localhost",
      ),
    ).rejects.toThrow("Invalid username/email or password");
    expect(mocks.findLocalDevelopmentTenant).not.toHaveBeenCalled();
    expect(mocks.findActiveTenantByHostname).not.toHaveBeenCalled();
  });

  it("rejects unknown management hosts without looking up an account", async () => {
    mocks.findActiveTenantByHostname.mockResolvedValue(null);

    await expect(
      loginWithPassword(
        "user@example.com",
        "correct-password",
        "TENANT_APP",
        undefined,
        "unknown.example.com",
      ),
    ).rejects.toThrow("Invalid username/email or password");
    expect(mocks.findAccountByEmailOrUsername).not.toHaveBeenCalled();
  });

  it("rejects shared/local login without an explicit tenant selection", async () => {
    await expect(loginWithPassword("USER@example.com", "correct-password", "TENANT_APP"))
      .rejects.toThrow("Select a tenant before signing in");
    expect(mocks.findAccountByEmailOrUsername).not.toHaveBeenCalled();
  });

});
