import { describe, expect, it, beforeAll } from "vitest";
import { decryptAtRest, encryptAtRest, hashToken } from "@/src/lib/auth/crypto";

describe("crypto helpers", () => {
  beforeAll(() => {
    process.env.TOTP_ENCRYPTION_KEY = "test-key-for-unit-tests-only";
  });

  it("encrypts and decrypts TOTP secrets", () => {
    const secret = "JBSWY3DPEHPK3PXP";
    const enc = encryptAtRest(secret);
    expect(enc).not.toContain(secret);
    expect(decryptAtRest(enc)).toBe(secret);
  });

  it("hashes tokens deterministically without exposing raw value", () => {
    const raw = "reset-token-value";
    const hash = hashToken(raw);
    expect(hash).not.toContain(raw);
    expect(hash).toHaveLength(64);
    expect(hashToken(raw)).toBe(hash);
  });
});
