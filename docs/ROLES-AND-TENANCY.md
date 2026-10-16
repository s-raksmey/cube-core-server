# Roles and Tenancy Model

## Hierarchy

```text
Platform (Cube Core)
└── Main Tenant = core-super-admin (exactly one, created by migration)
    ├── SuperAdmin users (via tenant_memberships)
    ├── Platform settings / defaults
    └── Sub-tenant A
    │   ├── Admin / Editor (scoped to A)
    │   └── Tenant app users / data for A
    └── Sub-tenant B
        ├── Admin / Editor (scoped to B)
        └── Tenant app users / data for B
```

## Unified identity

One `tenants` table (`MAIN` / `SUB`). **Users are unified**:

| Table | Purpose |
| --- | --- |
| `users` | Identity: names, optional username, unique email, password hash, status `PENDING` \| `ACTIVE` \| `LOCKED` \| `INACTIVE` |
| `roles` | Seeded: `SUPERADMIN`, `ADMIN`, `EDITOR` |
| `role_permissions` | SuperAdmin-configured permissions for the SUB `ADMIN` and `EDITOR` roles |
| `tenant_memberships` | Unique `(user_uuid, tenant_uuid)` + role |

| Role | Tenant type | Responsibility |
| --- | --- | --- |
| `SUPERADMIN` | MAIN only | Operate platform; manage sub-tenants and their users remotely |
| `ADMIN` | SUB | Full management inside that sub-tenant (including inviting users) |
| `EDITOR` | SUB | Day-to-day editing inside that sub-tenant |

Domain services enforce: MAIN membership ↔ SUPERADMIN; SUB membership ↔ ADMIN \| EDITOR.

Auth rows (`user_sessions`, challenges, TOTP, activation/reset tokens, recovery codes) reference `users.uuid`.

## Hard login rule

**SuperAdmin cannot log in to a sub-tenant.**

1. SuperAdmin sessions always belong to the **main tenant (`core-super-admin`)**.
2. SuperAdmin **cannot** authenticate into `cube-core-tenant` for any sub-tenant.
3. SuperAdmin **cannot** switch identity / session into an Admin or Editor.
4. SuperAdmin manages sub-tenants **remotely** from the main-tenant console via privileged APIs.

Only **Admin** and **Editor** may hold a login scoped to a sub-tenant.

## Tenant types

| Type | Meaning |
| --- | --- |
| Main tenant (`MAIN`) | Singleton platform tenant (`slug`: `core-super-admin`). Exactly one; created by migration, not by seed or admin UI. |
| Sub-tenant (`SUB`) | Child organization managed under the main tenant. |

## Identity rules

1. A user may have memberships, but login resolves an active membership for the requested audience.
2. SuperAdmin users belong to the **main tenant**.
3. Admin / Editor belong to a **sub-tenant**.
4. Authorization is always: `role` + `tenantId` (+ resource ownership checks).
5. UI may hide actions, but **server must reject** unauthorized GraphQL operations.
6. Login target is validated against role + tenant type + audience:
   - `ADMIN_CONSOLE` → **SuperAdmin only** (main tenant)
   - `TENANT_APP` → **Admin or Editor** on a sub-tenant only
   - SuperAdmin credentials must be rejected by the tenant app login path

## Sub-tenant role permissions

The Main Console owns the shared permission sets for the `ADMIN` and `EDITOR`
roles. They apply to those roles in every sub-tenant and are enforced by the
server on permission-gated operations. User-management permissions include:

- View users
- Create users
- Edit users
- Change user roles
- Activate users
- Suspend users
- Reset password
- Delete users

New databases give `ADMIN` View, Create, Edit, Activate, Suspend, and Reset
Password permissions. `EDITOR` starts with View and own-profile Edit permissions.
For analytics, `ADMIN` starts with `ANALYTICS_VIEW_TENANT` and `EDITOR` with
`ANALYTICS_VIEW_OWN`. The service derives tenant and author scope from the
authenticated session and the granted permission; see [ANALYTICS.md](./ANALYTICS.md).
General, Website maintenance and branding, Social Links, SEO, and Content
settings share `SETTINGS_VIEW` and `SETTINGS_UPDATE`. `ADMIN` starts with both;
`EDITOR` starts with view access only.
The tenant comes from the authenticated session; see
[GENERAL-SETTINGS.md](./GENERAL-SETTINGS.md).
`SUPERADMIN` remains a fixed Main Tenant role and is not configurable here.

## Activation lifecycle

1. Privileged actor creates user as `PENDING` + membership + activation token (~24h).
2. Invitee opens `/activate`: **username** + password + confirm (token not consumed yet).
3. Mandatory TOTP enroll + verify.
4. Recovery codes shown once; token consumed; status → `ACTIVE`.

Login accepts **username or email**. Active users must have 2FA enabled.

## Password reset

SuperAdmin-generated links only (no public forgot-password). Preserves 2FA; revokes sessions. Main SuperAdmins: `generateMainTenantUserPasswordResetLink`. Sub-tenant users: `generatePasswordResetLink`.

## Recommended core entities (logical model)

```text
Tenant
  - uuid
  - type: MAIN | SUB
  - parent_tenant_uuid (null for MAIN)

User
  - uuid
  - first_name, last_name
  - username (nullable until activation)
  - email (unique)
  - password_hash (nullable until activation)
  - status: PENDING | ACTIVE | LOCKED | INACTIVE

Role
  - uuid, code

TenantMembership
  - user_uuid, tenant_uuid (unique pair)
  - role_uuid
```
