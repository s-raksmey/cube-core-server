import { afterEach, describe, expect, it, vi } from "vitest";
import { generate, generateSecret } from "otplib";
import { totpTimeStep } from "@/src/lib/auth/totp";

describe("TOTP replay step", () => {
  afterEach(() => vi.useRealTimers());

  it("returns the matched step when accepting a code from the previous window", async () => {
    const now = 1_800_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(now * 1000);
    const secret = generateSecret();
    const previousStepEpoch = Math.floor(now / 30) * 30 - 30;
    const code = await generate({
      secret,
      epoch: previousStepEpoch,
      algorithm: "sha1",
      digits: 6,
      period: 30,
    });

    await expect(totpTimeStep(code, secret)).resolves.toBe(
      BigInt(previousStepEpoch / 30),
    );
  });
});
