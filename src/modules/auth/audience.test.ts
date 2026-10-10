import { describe, expect, it } from "vitest";
import { TenantType, UserStatus } from "@prisma/client";
import {
  assertConsoleAuthorization,
  type LoadedAccount,
} from "@/src/modules/users/account";

function account(
  partial: Pick<LoadedAccount, "roleCode"> & {
    tenantType: TenantType;
  },
): LoadedAccount {
  return {
    uuid: "user-1",
    email: "a@b.c",
    username: "auser",
    firstName: "Test",
    lastName: "User",
    fullName: "Test User",
    passwordHash: "x",
    status: UserStatus.ACTIVE,
    tenantUuid: "t-1",
    roleCode: partial.roleCode,
    membershipUuid: "m-1",
    totpSecretEnc: null,
    totpEnabledAt: null,
    sessionsRevokedAt: null,
    lockedUntil: null,
    tenant: {
      uuid: "t-1",
      name: "T",
      slug: "t",
      type: partial.tenantType,
      status: "ACTIVE",
    },
  };
}

describe("assertConsoleAuthorization", () => {
  it("allows MAIN SuperAdmin on main console", () => {
    expect(() =>
      assertConsoleAuthorization(
        account({
          roleCode: "SUPERADMIN",
          tenantType: TenantType.MAIN,
        }),
        "ADMIN_CONSOLE",
      ),
    ).not.toThrow();
  });

  it("rejects SUB Admin on main console", () => {
    expect(() =>
      assertConsoleAuthorization(
        account({
          roleCode: "ADMIN",
          tenantType: TenantType.SUB,
        }),
        "ADMIN_CONSOLE",
      ),
    ).toThrow();
  });

  it("rejects MAIN SuperAdmin on tenant console", () => {
    expect(() =>
      assertConsoleAuthorization(
        account({
          roleCode: "SUPERADMIN",
          tenantType: TenantType.MAIN,
        }),
        "TENANT_APP",
      ),
    ).toThrow();
  });

  it("allows SUB Editor on tenant console", () => {
    expect(() =>
      assertConsoleAuthorization(
        account({
          roleCode: "EDITOR",
          tenantType: TenantType.SUB,
        }),
        "TENANT_APP",
      ),
    ).not.toThrow();
  });

  it("rejects unsupported SUB Author on tenant console", () => {
    expect(() =>
      assertConsoleAuthorization(
        account({
          roleCode: "AUTHOR",
          tenantType: TenantType.SUB,
        }),
        "TENANT_APP",
      ),
    ).toThrow();
  });
});
