import { AuthAudience, AuthChallengeType } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { permitsPendingActivationEnrollment } from "@/src/modules/auth/totp.service";

describe("pending activation TOTP enrollment", () => {
  it.each([AuthAudience.ADMIN_CONSOLE, AuthAudience.TENANT_APP])(
    "allows a pending account to enroll through %s",
    (audience) => {
      expect(
        permitsPendingActivationEnrollment(
          { allowPendingActivation: true },
          { type: AuthChallengeType.TOTP_ENROLL, audience },
          { status: "PENDING" },
        ),
      ).toBe(true);
    },
  );

  it("does not permit a pending account through a normal sign-in challenge", () => {
    expect(
      permitsPendingActivationEnrollment(
        { allowPendingActivation: true },
        { type: AuthChallengeType.TOTP_VERIFY, audience: AuthAudience.TENANT_APP },
        { status: "PENDING" },
      ),
    ).toBe(false);
  });
});
