import bcrypt from "bcryptjs";
import { hash as argon2Hash, verify as argon2Verify } from "@node-rs/argon2";
import { z } from "zod";

export const passwordPolicySchema = z
  .string()
  .min(12, "Password must be at least 12 characters")
  .max(128)
  .regex(/[a-z]/, "Password must include a lowercase letter")
  .regex(/[A-Z]/, "Password must include an uppercase letter")
  .regex(/[0-9]/, "Password must include a number");

export async function hashPassword(password: string) {
  return argon2Hash(password, {
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
}

export async function verifyPassword(password: string, passwordHash: string) {
  if (passwordHash.startsWith("$argon2")) {
    return argon2Verify(passwordHash, password);
  }
  return bcrypt.compare(password, passwordHash);
}

/** Legacy bcrypt helper for seed/migration paths only. */
export async function hashPasswordBcrypt(password: string) {
  return bcrypt.hash(password, 12);
}
