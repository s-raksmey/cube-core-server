import { describe, expect, it } from "vitest";
import { ACTIVATION_TTL_MS, RECOVERY_CODE_COUNT } from "@/src/lib/auth/constants";

describe("activation lifecycle constants", () => {
  it("keeps activation links about 24 hours", () => {
    expect(ACTIVATION_TTL_MS).toBe(24 * 60 * 60 * 1000);
  });

  it("issues a fixed batch of recovery codes", () => {
    expect(RECOVERY_CODE_COUNT).toBe(8);
  });
});
