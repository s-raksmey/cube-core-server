import { describe, expect, it } from "vitest";
import { UserStatus } from "@prisma/client";
import {
  accountStatusLoginNotice,
  accountLockedNotice,
  failedAttemptNotice,
  failedAttemptOutcome,
} from "@/src/modules/auth/lockout.service";

describe("account lockout", () => {
  it("explains how to finish an incomplete account activation", () => {
    expect(accountStatusLoginNotice(UserStatus.PENDING)).toMatch(
      /activation link.*set your password.*finish two-factor setup/i,
    );
  });

  it("locks on the third failed credential attempt", () => {
    expect(failedAttemptOutcome(1)).toEqual({ locked: false, remaining: 2 });
    expect(failedAttemptOutcome(2)).toEqual({ locked: false, remaining: 1 });
    expect(failedAttemptOutcome(3)).toEqual({ locked: true, remaining: 0 });
  });

  it("gives a generic password error to avoid revealing account existence", () => {
    expect(failedAttemptNotice("password", 2)).toBe(
      failedAttemptNotice("password", 1),
    );
    expect(failedAttemptNotice("password", 2)).toMatch(/incorrect username\/email or password/i);
  });

  it("tells users why and how long an account is locked", () => {
    expect(accountLockedNotice(new Date())).toMatch(/temporarily locked/i);
    expect(accountLockedNotice(null)).toMatch(/contact a SuperAdmin/i);
  });
});
