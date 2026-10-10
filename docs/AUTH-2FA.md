# Authentication, 2FA, and password reset

## Consoles and cookies

| Console | App | Audience | Refresh cookie |
| --- | --- | --- | --- |
| Main | `cube-core-admin` | `ADMIN_CONSOLE` | `management_console_admin_session` |
| Sub-tenant | `cube-core-tenant` | `TENANT_APP` | `management_console_tenant_session` |

Access tokens (5m) use `management_console_*_access` cookies. Refresh tokens last 30 days and rotate on each refresh. Cookies are HttpOnly, `SameSite=Lax`, and scoped per console — never shared.

## Authorization

- **Main console:** `SUPERADMIN` on the main tenant only.
- **Sub-tenant console:** `ADMIN`, `EDITOR`, or `AUTHOR` on a sub-tenant only.
- SuperAdmin cannot authenticate into the tenant console.
- Sub-tenant roles cannot authenticate into the main console.

## Login sequence

1. Password verification by **username or email** (GraphQL `login` — server is GraphQL-only).
2. Short-lived signed **challenge** (no protected session; five-minute expiry).
3. First login (if 2FA not yet enabled): TOTP enrollment (QR shown once) + GraphQL `verifyTotpEnrollment`.
4. Returning login: GraphQL `verifyLoginTotp` (or `verifyRecoveryCode`).
5. The admin Server Action or tenant same-origin auth handler stores the returned session tokens in HttpOnly cookies; the browser receives only the user/challenge response. Token- and TOTP-secret-bearing GraphQL operations require an audience-specific server-to-server secret, so browser calls to GraphQL cannot retrieve those values directly.
6. Three failed password attempts or three failed 2FA/recovery attempts set account status to `LOCKED`, revoke sessions and outstanding challenges, and block login for 15 minutes. The next login attempt after the lock expires restores the previous pending/active state. SuperAdmins can manually restore a locked account from User Management.

Pre-authentication challenges and pending TOTP enrollment expire after five minutes. Activation removes the raw token from the browser URL after page load; after credentials are set, TOTP completion is bound to the short-lived enrollment challenge and does not resend the activation token. Activation token consumption, TOTP enablement, recovery-code persistence, and changing the account to `ACTIVE` commit in one database transaction.

The auth identity integrity migration adds case-insensitive unique indexes for email and username and a partial unique index that permits only one `MAIN` tenant. Before applying it to an existing database, reconcile any duplicates identified by the migration's preflight checks.

The admin uses typed, generated GraphQL documents from a Server Action for authentication and Apollo through a same-origin `/graphql` BFF route. The BFF refreshes/rotates the session only when its access cookie expires, then proxies the operation. The tenant uses its same-origin auth handlers as a BFF; they call the GraphQL server and set cookies without returning session tokens to browser JavaScript.

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
ADMIN_AUTH_ACTION_SECRET=...  # separate random secret shared only by server and admin runtimes
TENANT_AUTH_ACTION_SECRET=... # different random secret shared only by server and tenant runtimes
ADMIN_APP_URL=http://localhost:3000
TENANT_APP_URL=http://localhost:3001
```

## Tests

Run on server: `npm test` (Vitest — audience rules, last SuperAdmin protection, crypto, password policy).
