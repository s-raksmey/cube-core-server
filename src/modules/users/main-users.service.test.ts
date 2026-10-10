import { describe, expect, it } from "vitest";
import { UserStatus } from "@prisma/client";
import { assertCanRemoveLastActiveSuperAdmin } from "@/src/modules/users/main-users.service";

describe("assertCanRemoveLastActiveSuperAdmin", () => {
  it("rejects deleting yourself", () => {
    expect(() =>
      assertCanRemoveLastActiveSuperAdmin({
        targetUserId: "me",
        actorUserId: "me",
        targetStatus: UserStatus.ACTIVE,
        activeSuperAdminCount: 3,
      }),
    ).toThrow(/own account/i);
  });

  it("rejects removing the last active SuperAdmin", () => {
    expect(() =>
      assertCanRemoveLastActiveSuperAdmin({
        targetUserId: "other",
        actorUserId: "me",
        targetStatus: UserStatus.ACTIVE,
        activeSuperAdminCount: 1,
      }),
    ).toThrow(/last active SuperAdmin/i);
  });

  it("rejects changing the last active SuperAdmin to pending", () => {
    expect(() =>
      assertCanRemoveLastActiveSuperAdmin({
        targetUserId: "other",
        actorUserId: "me",
        targetStatus: UserStatus.ACTIVE,
        nextStatus: UserStatus.PENDING,
        activeSuperAdminCount: 1,
      }),
    ).toThrow(/last active SuperAdmin/i);
  });

  it("allows deleting another SuperAdmin when more than one remain active", () => {
    expect(() =>
      assertCanRemoveLastActiveSuperAdmin({
        targetUserId: "other",
        actorUserId: "me",
        targetStatus: UserStatus.ACTIVE,
        activeSuperAdminCount: 2,
      }),
    ).not.toThrow();
  });

  it("allows deleting an already-disabled SuperAdmin even if only one active remains", () => {
    expect(() =>
      assertCanRemoveLastActiveSuperAdmin({
        targetUserId: "other",
        actorUserId: "me",
        targetStatus: UserStatus.DISABLED,
        activeSuperAdminCount: 1,
      }),
    ).not.toThrow();
  });
});
