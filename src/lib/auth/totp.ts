import { generateSecret, verify } from "otplib";
import QRCode from "qrcode";

const TOTP_DEFAULTS = {
  algorithm: "sha1" as const,
  digits: 6 as const,
  period: 30 as const,
  /** Allow one period of clock skew in either direction. */
  epochTolerance: [30, 30] as [number, number],
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

export async function totpTimeStep(
  code: string,
  secret: string,
): Promise<bigint | null> {
  const normalized = code.replace(/\s+/g, "");
  const cleanedSecret = secret.replace(/\s+/g, "").toUpperCase();
  if (!/^\d{6}$/.test(normalized)) {
    return null;
  }
  const result = await verify({
    secret: cleanedSecret,
    token: normalized,
    algorithm: TOTP_DEFAULTS.algorithm,
    digits: TOTP_DEFAULTS.digits,
    period: TOTP_DEFAULTS.period,
    epochTolerance: TOTP_DEFAULTS.epochTolerance,
  });
  return result.valid && "timeStep" in result
    ? BigInt(result.timeStep)
    : null;
}
