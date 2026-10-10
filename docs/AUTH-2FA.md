# Authentication, 2FA, and password reset

## Consoles and cookies

| Console | App | Audience | Refresh cookie |
| --- | --- | --- | --- |
| Main | `cube-core-admin` | `ADMIN_CONSOLE` | `management_console_admin_session` |
| Sub-tenant | `cube-core-tenant` | `TENANT_APP` | `management_console_tenant_session` |

Access tokens (30s) use `management_console_*_access` cookies. Refresh tokens last 30 days. Cookies are HttpOnly, `SameSite=Lax`, and scoped per console — never shared.

## Authorization

- **Main console:** `SUPERADMIN` on the main tenant only.
- **Sub-tenant console:** `ADMIN`, `EDITOR`, or `AUTHOR` on a sub-tenant only.
- SuperAdmin cannot authenticate into the tenant console.
- Sub-tenant roles cannot authenticate into the main console.

## Login sequence

1. Password verification by **username or email** (GraphQL `login` — server is GraphQL-only).
2. Short-lived signed **challenge** (no protected session).
3. First login (if 2FA not yet enabled): TOTP enrollment (QR shown once) + GraphQL `verifyTotpEnrollment`.
4. Returning login: GraphQL `verifyLoginTotp` (or `verifyRecoveryCode`).
5. Admin Server Action sets HttpOnly access/refresh cookies; then hard navigate to the console.

`cube-core-admin` uses Apollo → `/graphql` rewrite → server (no auth HTTP proxy routes on admin).

## Activation

1. Privileged create → `PENDING` user + membership + hashed activation token (~24h).
2. `/activate?token=…`: **username** + password + confirm (token stays open).
3. Mandatory TOTP enroll + verify.
4. Recovery codes shown once; token consumed; status → `ACTIVE`.
5. Redirect to `/login` (no session issued during activation).

Main Console activations use `ADMIN_APP_URL`. Sub-tenant invitations use `TENANT_APP_URL`.

## Password reset

- **No self-service** forgot-password flow.
- Only **SuperAdmin** generates reset links.
- A SuperAdmin **cannot** generate a reset link for their own account (another SuperAdmin must do it).
- **Main Tenant SuperAdmins:** `generateMainTenantUserPasswordResetLink`.
- **Sub-tenant users:** `generatePasswordResetLink`.
- Reset links expire in 15 minutes, single-use, stored as hashes only.
- Reset preserves 2FA; revokes all sessions.
- Reset pages: `/password-reset?token=…` on admin or tenant.

## Main Tenant User Management

GraphQL (SuperAdmin / `ADMIN_CONSOLE` only):

- `mainTenantUsers` — MAIN `SUPERADMIN` memberships only
- `createMainTenantUser(firstName, lastName, email)` — returns activation URL
- `updateMainTenantUser` / `deleteMainTenantUser`
- `generateMainTenantUserActivationLink` / `generateMainTenantUserPasswordResetLink`

## Environment

```text
AUTH_SECRET=...
TOTP_ENCRYPTION_KEY=...   # optional; falls back to AUTH_SECRET
ADMIN_APP_URL=http://localhost:3000
TENANT_APP_URL=http://localhost:3001
```

## Tests

Run on server: `npm test` (Vitest — audience rules, last SuperAdmin protection, crypto, password policy).
