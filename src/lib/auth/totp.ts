import { generateSecret, generate, verify } from "otplib";
import QRCode from "qrcode";

const TOTP_DEFAULTS = {
  algorithm: "sha1" as const,
  digits: 6 as const,
  period: 30 as const,
  /** Allow ±2 periods for phone/server clock skew. */
  epochTolerance: 60,
};

export function generateTotpSecret(): string {
  return generateSecret().replace(/=+$/, "").toUpperCase();
}

/**
 * Build a standards-compliant otpauth URI.
 * Explicit algorithm/digits/period improve authenticator app compatibility.
 */
export function buildOtpAuthUri(email: string, secret: string) {
  const label = `CubeCore:${email.trim()}`;
  const params = new URLSearchParams({
    secret: secret.replace(/\s+/g, "").toUpperCase(),
    issuer: "CubeCore",
    algorithm: "SHA1",
    digits: String(TOTP_DEFAULTS.digits),
    period: String(TOTP_DEFAULTS.period),
  });
  return `otpauth://totp/${encodeURIComponent(label)}?${params.toString()}`;
}

export async function qrCodeDataUrl(otpauthUri: string) {
  return QRCode.toDataURL(otpauthUri, { margin: 1, width: 256, errorCorrectionLevel: "M" });
}

export async function verifyTotpCode(secret: string, code: string): Promise<boolean> {
  const normalized = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(normalized)) {
    return false;
  }

  const cleanedSecret = secret.replace(/\s+/g, "").toUpperCase();
  const result = await verify({
    secret: cleanedSecret,
    token: normalized,
    algorithm: TOTP_DEFAULTS.algorithm,
    digits: TOTP_DEFAULTS.digits,
    period: TOTP_DEFAULTS.period,
    epochTolerance: TOTP_DEFAULTS.epochTolerance,
  });

  return result.valid === true;
}

/** Returns the current expected code for diagnostics / tests only. */
export async function currentTotpCode(secret: string): Promise<string> {
  return generate({
    secret: secret.replace(/\s+/g, "").toUpperCase(),
    algorithm: TOTP_DEFAULTS.algorithm,
    digits: TOTP_DEFAULTS.digits,
    period: TOTP_DEFAULTS.period,
  });
}

export async function totpTimeStep(
  code: string,
  secret: string,
): Promise<bigint | null> {
  const normalized = code.replace(/\s+/g, "");
  const cleanedSecret = secret.replace(/\s+/g, "").toUpperCase();
  if (!(await verifyTotpCode(cleanedSecret, normalized))) {
    return null;
  }

  return BigInt(Math.floor(Date.now() / 1000 / TOTP_DEFAULTS.period));
}
