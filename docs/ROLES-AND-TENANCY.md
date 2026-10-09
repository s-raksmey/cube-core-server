# Roles and Tenancy Model

## Hierarchy

```text
Platform (Cube Core)
└── Main Tenant = core-super-admin (exactly one, created by migration)
    ├── SuperAdmin users
    ├── Platform settings / defaults
    └── Sub-tenant A
    │   ├── Admin users (scoped to A)
    │   └── Tenant app users / data for A
    └── Sub-tenant B
        ├── Admin users (scoped to B)
        └── Tenant app users / data for B
```

## Console roles (exactly two)

| Role | Scope | Responsibility |
| --- | --- | --- |
| `SUPERADMIN` | Main tenant only (login) | Operate Core Admin; manage sub-tenants and Admins from outside them |
| `ADMIN` | One sub-tenant (login) | Operate that sub-tenant only |

No other console roles in v1.

## Hard login rule

**SuperAdmin cannot log in to a sub-tenant.**

That means:

1. SuperAdmin sessions always belong to the **main tenant (Core Admin)**.
2. SuperAdmin **cannot** authenticate into `cube-core-tenant` for any sub-tenant.
3. SuperAdmin **cannot** switch identity / session into an Admin or sub-tenant user.
4. SuperAdmin **cannot** open a sub-tenant “as if logged into that tenant”.
5. SuperAdmin manages sub-tenants **remotely** from the Core Admin console via privileged APIs (create, suspend, configure, manage Admins), while remaining a main-tenant actor.

Only **Admin** (and later sub-tenant app users) may hold a login scoped to a sub-tenant.

## Tenant types

| Type | Code suggestion | Meaning |
| --- | --- | --- |
| Main tenant | `MAIN` | Singleton platform tenant (`slug`: `core-super-admin`). Exactly one; created by migration, not by seed or admin UI. |
| Sub-tenant | `SUB` | Child organization managed under the main tenant. |

## Identity rules

1. Every user belongs to **exactly one tenant**.
2. SuperAdmin users belong to the **main tenant**.
3. Admin users belong to a **sub-tenant**.
4. Authorization is always: `role` + `tenantId` (+ resource ownership checks).
5. UI may hide actions, but **server must reject** unauthorized GraphQL operations.
6. Login target is validated against role + tenant type:
   - `SUPERADMIN` → main tenant console only
   - `ADMIN` → sub-tenant console scope only
   - SuperAdmin credentials must be rejected by any sub-tenant login path

## Recommended core entities (logical model)

```text
Tenant
  - id
  - type: MAIN | SUB
  - parentTenantId (null for MAIN; MAIN id for SUB)
  - name
  - slug
  - status: ACTIVE | SUSPENDED
  - settings (JSON)
  - createdAt / updatedAt

User
  - id
  - tenantId
  - email
  - passwordHash
  - role: SUPERADMIN | ADMIN
  - status: ACTIVE | DISABLED
  - createdAt / updatedAt

AuditLog
  - id
  - actorUserId
  - actorTenantId
  - targetTenantId
  - action
  - metadata (JSON)
  - createdAt
```

> Application-specific entities for `cube-core-tenant` (orders, content, etc.) should always include `tenantId` and never be readable across tenants.

## Permission matrix (v1)

| Capability | SuperAdmin | Admin |
| --- | --- | --- |
| Login as main-tenant console user | Yes | No |
| Login as sub-tenant console user | **No** | Yes |
| Login to `cube-core-tenant` app | **No** | No (unless you later define Admin as tenant-app user too) |
| View platform dashboard | Yes | No |
| Manage main tenant profile | Yes | No |
| Create / suspend sub-tenants | Yes | No |
| List all sub-tenants | Yes | No |
| Manage Admins across tenants | Yes | No |
| Manage users inside a sub-tenant (remote API) | Yes (manage as SuperAdmin) | Yes (own tenant only) |
| Act from inside a sub-tenant session | **No** | Yes (own) |
| Edit sub-tenant settings | Yes (remote manage) | Yes (own) |
| View platform audit log | Yes | No |
| View own tenant audit log | Yes (platform/main) | Yes (own sub-tenant) |
| Access other sub-tenant data while logged in as that tenant | **No** | No |

## No sub-tenant login / no impersonation (v1)

Do **not** implement for SuperAdmin:

- Sub-tenant login
- “Enter tenant” session switch
- User impersonation
- Acting with `contextTenantId` as if SuperAdmin were inside that tenant

SuperAdmin support workflow in v1:

- Stay logged into Core Admin
- Open sub-tenant record in the console
- Use privileged management mutations/queries that take an explicit `targetTenantId`
- Actor in audit logs remains the SuperAdmin + main tenant

Admin users never switch tenant context.

## Security invariants (non-negotiable)

1. Suspended tenant → all its users cannot access console/tenant apps.
2. Disabled user → cannot authenticate.
3. Every GraphQL resolver that returns tenant data must apply tenancy filter.
4. Slug uniqueness is global.
5. Creating an Admin requires a valid target sub-tenant id.
6. SuperAdmin cannot be created under a sub-tenant.
7. Admin cannot be created under the main tenant (keeps role meaning clear).
8. SuperAdmin login into any sub-tenant path must fail.
9. SuperAdmin session `tenantId` must always remain the main tenant id.
