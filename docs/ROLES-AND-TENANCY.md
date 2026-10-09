# Roles and Tenancy Model

## Hierarchy

```text
Platform (Cube Core)
└── Main Tenant = core-super-admin (exactly one, created by migration)
    ├── SuperAdmin users
    ├── Platform settings / defaults
    └── Sub-tenant A
    │   ├── Admin users (scoped to A)
    │   ├── Editor users (scoped to A)
    │   └── Tenant app users / data for A
    └── Sub-tenant B
        ├── Admin users (scoped to B)
        ├── Editor users (scoped to B)
        └── Tenant app users / data for B
```

## Console roles

| Role | Tenant type | Responsibility |
| --- | --- | --- |
| `SUPERADMIN` | Main tenant only | Operate platform; manage sub-tenants and their Admins/Editors remotely |
| `ADMIN` | One sub-tenant | Full management inside that sub-tenant |
| `EDITOR` | One sub-tenant | Day-to-day editing inside that sub-tenant (limited admin powers) |

Sub-tenant console roles are exactly two: **Admin** and **Editor**.

## Hard login rule

**SuperAdmin cannot log in to a sub-tenant.**

That means:

1. SuperAdmin sessions always belong to the **main tenant (`core-super-admin`)**.
2. SuperAdmin **cannot** authenticate into `cube-core-tenant` for any sub-tenant.
3. SuperAdmin **cannot** switch identity / session into an Admin or Editor.
4. SuperAdmin **cannot** open a sub-tenant “as if logged into that tenant”.
5. SuperAdmin manages sub-tenants **remotely** from the main-tenant console via privileged APIs, while remaining a main-tenant actor.

Only **Admin** and **Editor** may hold a login scoped to a sub-tenant.

## Tenant types

| Type | Code suggestion | Meaning |
| --- | --- | --- |
| Main tenant | `MAIN` | Singleton platform tenant (`slug`: `core-super-admin`). Exactly one; created by migration, not by seed or admin UI. |
| Sub-tenant | `SUB` | Child organization managed under the main tenant. |

## Identity rules

1. Every user belongs to **exactly one tenant**.
2. SuperAdmin users belong to the **main tenant**.
3. Admin and Editor users belong to a **sub-tenant**.
4. Authorization is always: `role` + `tenantId` (+ resource ownership checks).
5. UI may hide actions, but **server must reject** unauthorized GraphQL operations.
6. Login target is validated against role + tenant type + audience:
   - `ADMIN_CONSOLE` → SuperAdmin (main) or Admin/Editor (sub)
   - `TENANT_APP` → Admin/Editor on a sub-tenant only
   - SuperAdmin credentials must be rejected by the tenant app login path

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
  - role: SUPERADMIN | ADMIN | EDITOR
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

| Capability | SuperAdmin | Admin | Editor |
| --- | --- | --- | --- |
| Login as main-tenant console user | Yes | No | No |
| Login as sub-tenant console user | **No** | Yes | Yes |
| Login to `cube-core-tenant` app | **No** | No* | No* |
| View platform dashboard | Yes | No | No |
| Manage main tenant profile | Yes | No | No |
| Create / suspend sub-tenants | Yes | No | No |
| List all sub-tenants | Yes | No | No |
| Manage Admins/Editors across tenants (remote) | Yes | No | No |
| Act from inside a sub-tenant session | **No** | Yes (own) | Yes (own) |
| View sub-tenant dashboard | No (remote only) | Yes | Yes |
| Edit day-to-day sub-tenant content/data | Yes (remote) | Yes | Yes |
| Manage Editor users in own sub-tenant | Yes (remote) | Yes | No |
| Manage Admin users in own sub-tenant | Yes (remote) | Yes | No |
| Edit sensitive sub-tenant settings | Yes (remote) | Yes | No |
| View own tenant audit log | Yes (platform/main) | Yes | Yes (own actions / limited) |
| Access other sub-tenant data while logged in as that tenant | **No** | No | No |

\* Tenant-app end users are separate from console Admin/Editor unless you later decide otherwise.

## Admin vs Editor (sub-tenant)

| Area | Admin | Editor |
| --- | --- | --- |
| Scope | One sub-tenant | One sub-tenant |
| Users | Can create/disable Admin + Editor in own tenant | Cannot manage users |
| Settings | Full tenant settings allowed for console | Read or limited non-sensitive settings only |
| Content / operations | Full | Full day-to-day edit |
| Dangerous actions | Can disable users, change roles | No |

## No sub-tenant login / no impersonation for SuperAdmin (v1)

Do **not** implement for SuperAdmin:

- Sub-tenant login
- “Enter tenant” session switch
- User impersonation
- Acting with `contextTenantId` as if SuperAdmin were inside that tenant

SuperAdmin support workflow in v1:

- Stay logged into main tenant console
- Open sub-tenant record in the console
- Use privileged management mutations/queries that take an explicit `targetTenantId`
- Actor in audit logs remains the SuperAdmin + main tenant

Admin and Editor never switch tenant context.

## Security invariants (non-negotiable)

1. Suspended tenant → all its users cannot access console/tenant apps.
2. Disabled user → cannot authenticate.
3. Every GraphQL resolver that returns tenant data must apply tenancy filter.
4. Slug uniqueness is global.
5. Creating an Admin or Editor requires a valid target sub-tenant id.
6. SuperAdmin cannot be created under a sub-tenant.
7. Admin and Editor cannot be created under the main tenant.
8. SuperAdmin login into any sub-tenant path must fail.
9. SuperAdmin session `tenantId` must always remain the main tenant id.
10. Exactly one MAIN tenant exists (`core-super-admin`).
