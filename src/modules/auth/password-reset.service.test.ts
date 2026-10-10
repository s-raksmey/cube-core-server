import { describe, expect, it } from "vitest";
import { assertNotSelfPasswordReset } from "@/src/modules/auth/password-reset.service";

describe("assertNotSelfPasswordReset", () => {
  it("rejects resetting your own account", () => {
    expect(() => assertNotSelfPasswordReset("me", "me")).toThrow(
      /own account/i,
    );
  });

  it("allows resetting another account", () => {
    expect(() => assertNotSelfPasswordReset("me", "other")).not.toThrow();
  });
});
