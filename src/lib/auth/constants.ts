import type { AuthAudience } from "@prisma/client";

/** HttpOnly refresh session cookies — one per console, never shared. */
export const REFRESH_COOKIE_BY_AUDIENCE: Record<AuthAudience, string> = {
  ADMIN_CONSOLE: "management_console_admin_session",
  TENANT_APP: "management_console_tenant_session",
};

export const ACCESS_COOKIE_BY_AUDIENCE: Record<AuthAudience, string> = {
  ADMIN_CONSOLE: "management_console_admin_access",
  TENANT_APP: "management_console_tenant_access",
};

export const ACCESS_TOKEN_TTL = "5m";
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Main and tenant console sessions expire after this much inactivity. */
export const CONSOLE_SESSION_IDLE_TIMEOUT_MS = 60 * 60 * 1000;
/** Pre-auth challenge (password → 2FA). Must cover QR scan + code entry. */
export const CHALLENGE_TTL_MS = 5 * 60 * 1000;
/** Pending TOTP secret before first verified code. Keep aligned with challenge TTL. */
export const TOTP_PENDING_TTL_MS = CHALLENGE_TTL_MS;
/** Single-use password reset links issued by either management console. */
export const PASSWORD_RESET_TTL_MS = 2 * 60 * 60 * 1000;
/** Account activation links (SuperAdmin-provisioned). */
export const ACTIVATION_TTL_MS = 24 * 60 * 60 * 1000;
export const MAX_CHALLENGE_ATTEMPTS = 3;
export const MAX_ACCOUNT_AUTH_ATTEMPTS = 3;
export const ACCOUNT_LOCKOUT_TTL_MS = 15 * 60 * 1000;
export const RECOVERY_CODE_COUNT = 8;

export type LoginAudience = AuthAudience;
