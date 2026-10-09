# Software Architecture

## High-level view

```text
┌────────────────┐   ┌────────────────┐   ┌────────────────┐
│ cube-core-     │   │ cube-core-     │   │ cube-core-     │
│ website        │   │ admin          │   │ tenant         │
│ (public site)  │   │ (console UI)   │   │ (tenant app)   │
└───────┬────────┘   └───────┬────────┘   └───────┬────────┘
        │                    │ GraphQL            │ GraphQL
        │ (mostly static)    │                    │
        └────────────────────┼────────────────────┘
                             ▼
                 ┌───────────────────────┐
                 │   cube-core-server    │
                 │ Next.js + GraphQL API │
                 │ Auth / Domain / Audit │
                 └───────────┬───────────┘
                             ▼
                      ┌────────────┐
                      │  Database  │
                      └────────────┘
```

## Recommended style

**Modular monolith API** in `cube-core-server`, with separate Next.js frontends.

Why this fits now:

- Four repos already exist; keep boundaries clear without microservices overhead
- GraphQL gives one contract for admin + tenant clients
- Tenancy + role rules stay centralized (harder to leak data)
- You can split services later if load or team size requires it

Avoid starting with many microservices. The risk is duplicated auth/tenant logic and slower delivery.

## Repo responsibilities

### `cube-core-server` (system of record)

- GraphQL schema + resolvers
- Authentication / session issuance
- Authorization (role + tenant guards)
- Domain services: tenants, users, settings, audit
- Database access
- Background-safe utility endpoints (health, webhooks later)

Suggested internal folders (when implementation starts):

```text
app/
  api/graphql/          # GraphQL HTTP handler
src/
  modules/
    auth/
    tenants/
    users/
    audit/
    platform/
  graphql/
    schema/
    resolvers/
    context.ts
  lib/
    db/
    auth/
    errors/
    validation/
```

### `cube-core-admin` (management console)

- SuperAdmin + Admin UI only
- Calls GraphQL for all privileged operations
- Shows navigation based on role
- Never stores secrets beyond session cookies / tokens needed for auth
- Tailwind for layout/components

Suggested areas:

```text
app/
  (auth)/login
  (console)/dashboard
  (console)/tenants          # SuperAdmin
  (console)/admins           # SuperAdmin
  (console)/users            # Admin (+ SuperAdmin)
  (console)/settings
  (console)/audit
src/
  components/
  graphql/
  lib/auth/
  lib/rbac/
```

### `cube-core-tenant` (sub-tenant product app)

- Tenant-facing product experience
- Authenticated against the same server (or same auth domain)
- Strictly scoped to one sub-tenant
- No platform management screens
- SuperAdmin must be rejected at login (cannot enter sub-tenant app)

### `cube-core-website` (marketing)

- Public pages only
- No direct privileged GraphQL mutations
- May deep-link to admin/tenant login

## Request / data flow

### Console login

```text
User submits credentials in cube-core-admin
  → GraphQL mutation login
  → server validates user + tenant status
  → server returns HTTP-only signed cookie session (jose) with role + tenantId
  → admin app stores session securely
  → subsequent GraphQL requests send session
  → server builds GraphQL context { user, role, tenantId }
  → resolver checks permission matrix
  → returns scoped data
```

### SuperAdmin creates a sub-tenant

```text
SuperAdmin form in admin UI
  → createSubTenant mutation
  → authz: role must be SUPERADMIN
  → domain service creates Tenant(type=SUB, parent=MAIN)
  → optional: create first Admin user for that tenant
  → write AuditLog
  → return tenant
  → UI refreshes tenant list
```

### Admin manages users in own tenant

```text
Admin opens Users page
  → users query
  → authz: role ADMIN
  → server forces filter tenantId = context.tenantId
  → returns only that sub-tenant’s users
```

## GraphQL API shape (initial)

### Queries

- `me`
- `mainTenant` (SuperAdmin)
- `subTenants` / `subTenant(id|slug)` (SuperAdmin)
- `tenantUsers` (scoped)
- `auditLogs` (scoped by role)
- `platformDashboard` (SuperAdmin)
- `tenantDashboard` (Admin only for own tenant; SuperAdmin uses management queries with `targetTenantId`, not a sub-tenant session)

### Mutations

- `login` / `logout` / `requestPasswordReset` / `resetPassword`
- `updateMainTenant`
- `createSubTenant` / `updateSubTenant` / `setSubTenantStatus`
- `createAdminUser` / `updateUser` / `setUserStatus`
- `updateTenantSettings`

Keep schema grouped by module; do not put all business logic in resolvers. Resolvers should call domain services.

## Authorization approach

Put checks in one place used by all resolvers:

```text
GraphQL Context
  → requireAuth()
  → requireRole('SUPERADMIN' | 'ADMIN')
  → requireTenantAccess(targetTenantId)
```

Rules:

- SuperAdmin session `tenantId` is always the **main tenant**
- SuperAdmin may manage a sub-tenant only through privileged operations that take an explicit `targetTenantId`
- SuperAdmin must never receive a session bound to a sub-tenant
- Sub-tenant login paths must reject `SUPERADMIN` users
- Admin may only target `context.tenantId`
- Suspended tenant short-circuits to forbidden/unauthenticated policy you choose (prefer clear error)

## Multi-tenant data strategy

**Recommended for v1: shared database, shared schema, `tenantId` column on every tenant-owned table.**

Why:

- Simpler ops for a new platform
- Easy SuperAdmin cross-tenant reporting
- Enough isolation if every query is scoped and indexed by `tenantId`

Revisit schema-per-tenant or DB-per-tenant only if compliance/contracts require stronger physical isolation.

## Cross-cutting concerns

| Concern | Approach |
| --- | --- |
| Validation | Shared Zod schemas at API boundary |
| Errors | Typed GraphQL errors (`UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `VALIDATION`) |
| Audit | Write on every privileged mutation |
| Logging | Request id + user id + tenant id on server logs |
| Config | Env vars; never commit secrets |
| Testing | Unit domain services + authz tests + a few GraphQL integration tests |

## Architecture decisions (ADR-style summary)

1. **Modular monolith server** over microservices for v1
2. **Two console roles only** — extend later if needed
3. **One main tenant** — no multi-reseller hierarchy yet
4. **Shared DB + tenantId** isolation
5. **GraphQL as the only client API** for admin/tenant apps
6. **UI authorization is cosmetic; server authorization is mandatory**

## What not to do yet

- Separate auth microservice
- Event-driven choreography between many services
- Duplicate business rules in each frontend
- Building full RBAC matrix before the two-role model is working end-to-end
