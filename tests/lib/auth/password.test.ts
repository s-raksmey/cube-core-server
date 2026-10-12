import { describe, expect, it } from "vitest";
import { passwordPolicySchema } from "@/src/lib/auth/password";

describe("passwordPolicySchema", () => {
  it("accepts strong passwords", () => {
    expect(passwordPolicySchema.safeParse("Password123!").success).toBe(true);
  });

  it("rejects short passwords", () => {
    expect(passwordPolicySchema.safeParse("Short1!").success).toBe(false);
  });

  it("rejects passwords missing complexity rules", () => {
    expect(passwordPolicySchema.safeParse("passwordonlylong").success).toBe(false);
  });
});
