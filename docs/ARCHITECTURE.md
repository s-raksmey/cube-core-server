# Software Architecture

Cursor agents must follow `.cursor/rules/cube-core-architecture.mdc` (mirrored in admin/tenant/website). Treat this doc as the human-readable source of truth; keep the rule in sync when architecture changes.

## High-level view

```text
┌────────────────┐   ┌────────────────┐   ┌────────────────┐
│ cube-core-     │   │ cube-core-     │   │ cube-core-     │
│ website        │   │ admin          │   │ tenant         │
│ (public reads) │   │ (console UI)   │   │ (tenant app)   │
└───────┬────────┘   └───────┬────────┘   └───────┬────────┘
        │                    │ GraphQL            │ GraphQL
        │ (mostly static)    │                    │
        └────────────────────┼────────────────────┘
                             ▼
                 ┌───────────────────────┐
                 │   cube-core-server    │
                 │ GraphQL Yoga (HTTP)   │
                 │ Auth / Domain / Audit │
                 └───────────┬───────────┘
                             ▼
                      ┌────────────┐
                      │  Database  │
                      └────────────┘
```

## Recommended style

**Modular monolith** in `cube-core-server`, with separate Next.js frontends.

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

Internal layout:

```text
src/
  index.ts              # Node HTTP + GraphQL Yoga → /graphql only
  modules/
    auth/
    tenants/
    users/
    dashboard/
  graphql/
    schema.graphql      # single SDL contract (auth + domain)
    helpers.ts          # requireSession, mergeResolvers
    context.ts
    resolvers/
      index.ts          # createSchema + merge domain maps
      types.ts          # LoginResult / Tenant / User field resolvers
      auth/             # one file per auth operation + index.ts
      dashboard/
      tenants/
      users/
  lib/
    db/
    auth/
    errors/
tests/
  graphql/              # GraphQL context and resolver integration tests
  lib/                   # shared-library unit tests
  modules/               # domain service and authorization tests, mirroring src/modules
```

Production code stays under `src/`. Test files live only under `tests/`, grouped by the production domain they cover.

The server is **GraphQL-only** — no Next.js `app/`, no REST `/auth` or `/api` routes. Login, 2FA, activation, password reset, and refresh are GraphQL queries/mutations.

Keep **one** SDL file (`schema.graphql`). Split **resolvers** by domain folder with one operation per file (`*-resolver.ts` + domain `index.ts`). Domain business logic stays in `src/modules/*` — resolvers stay thin.

### `cube-core-admin` (management console)

- SuperAdmin UI only
- Console **data + auth** via Apollo (`src/graphql/*.gql` → `src/lib/apollo/generated`); types via `npm run graphql:codegen`
- Admin routes same-origin `/graphql` through a Next.js BFF Route Handler; login Server Actions and the BFF establish/rotate/clear HttpOnly cookies
- Never stores session tokens in `localStorage` or JS-readable cookies
- Tailwind + **shadcn/ui** for layout/components

Layout (`src/` app — Next.js `src` directory):

```text
src/
  app/                       # routes: login, activate, graphql/route.ts, (console)/…
  components/
  hooks/
  graphql/*.gql              # GraphQL operation documents
  lib/
    apollo-client.ts         # Apollo client
    apollo/operations.ts     # generated Apollo document exports
    apollo/generated/        # codegen output
    auth/session-actions.ts  # server-side GraphQL auth + HttpOnly cookie setup
    auth/upstream-actions.ts # server-only activate/reset helpers
next.config.ts               # frontend configuration
```

### `cube-core-tenant` (sub-tenant product app)

- Tenant-facing product experience
- Authenticated against the same server (or same auth domain)
- Strictly scoped to one sub-tenant
- No platform management screens
- SuperAdmin must be rejected at login (cannot enter sub-tenant app)
- Next.js `src/` layout (`src/app`, `src/components`, `src/lib`, …)
- GraphQL operations in `src/graphql/*.gql`; generated Apollo documents/types in `src/lib/apollo/generated` via `npm run graphql:codegen`
- Apollo client/provider and same-origin `/graphql` Route Handler, with tenant session refresh/cookie forwarding

### `cube-core-website` (marketing)

- Public pages and public GraphQL reads only; no privileged mutations or authenticated console operations
- GraphQL operations in `src/graphql/*.gql`; generated Apollo documents/types in `src/lib/apollo/generated` via `npm run graphql:codegen`
- Apollo client/provider and same-origin `/graphql` Route Handler
- May deep-link to admin/tenant login
- Next.js `src/` layout (`src/app`, `src/components`, `src/lib`, …)

## Request / data flow

### Console login

```text
User opens `/` (landing) → Get Started navigates to `/login`
  → User submits credentials on `/login`
  → typed generated Login operation called by an admin Server Action
  → server validates user + tenant status + audience rules
  → challenge → verifyLoginTotp / verifyTotpEnrollment / verifyRecoveryCode
  → verification result → Server Action stores HttpOnly access/refresh cookies; tokens never reach browser JavaScript
  → same-origin GraphQL BFF forwards the access cookie and rotates the refresh session only when access expires
  → server builds GraphQL context { user, role, tenantId }
  → resolver checks permission matrix
  → returns scoped data
```

Identity is unified (`users` + `roles` + `tenant_memberships`). Main Console SuperAdmin accounts are provisioned via User Management (`createMainTenantUser`) with an activation link — never self-registered. Sub-tenant Admin/Editor invites use `createAdminUser` (activation, not plaintext password). Audience `ADMIN_CONSOLE` allows MAIN / SuperAdmin only. Audience `TENANT_APP` allows SUB / Admin|Editor only. Login accepts username or email.

### Main Tenant user management

```text
SuperAdmin opens /users (User Management)
  → mainTenantUsers query (MAIN + SUPERADMIN memberships only)
  → createMainTenantUser(firstName, lastName, email) → PENDING user + membership + `/activate` URL
  → invitee sets username + password + 2FA + saves recovery codes
  → updateMainTenantUser (first/last/email/status; role/tenant fixed)
  → deleteMainTenantUser (soft-disable + revoke sessions)
  → generateMainTenantUserPasswordResetLink / generateMainTenantUserActivationLink
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

### Tenant domain resolution

```text
Management or public website hostname
  → public tenantByHostname(hostname, purpose) GraphQL query
  → normalize hostname and resolve an active MANAGEMENT or WEBSITE mapping
  → return only active SUB tenant identity/configuration
  → use the tenant UUID for subsequent data operations
  → each protected operation still checks session role + tenant membership
```

`tenant_domains` maps a tenant UUID and purpose (`MANAGEMENT` or `WEBSITE`) to a normalized unique hostname. Hostname resolution is identification only; it is never authentication or authorization. Production resolves only verified active domain mappings. Local development stores a single `localhost` assignment in `local_development_tenants`, separate from production domains. SuperAdmin can move that assignment atomically between sub-tenants; shared ports 3001 and 3002 then resolve the same assigned tenant without a URL UUID, slug, or per-tenant environment variable. The tenant app still scopes login to the resolved tenant and checks membership, role, status, and audience before issuing a challenge. The public website resolves its `WEBSITE` hostname on each request and disables shared caching for the tenant lookup. Forwarded host headers are not trusted; apps read the incoming `Host` and reverse proxies must preserve it while stripping client-supplied forwarding headers.

### Admin manages users in own tenant

```text
Admin opens Users page
  → users query
  → authz: role ADMIN
  → server forces filter tenantId = context.tenantId
  → returns only that sub-tenant’s users
```

## GraphQL shape (current)

Single data contract: GraphQL on the server (`/graphql` only). Admin and tenant use same-origin `/graphql` Route Handlers as BFFs; website uses a same-origin Route Handler for public reads. Authenticated BFFs refresh and rotate session cookies only when access tokens expire. Login Server Actions and auth BFFs set or clear **HttpOnly** session cookies. Activation and password-reset Server Actions call the server GraphQL endpoint. Do **not** put session tokens in `localStorage` or JS-readable cookies.

The admin and tenant BFFs must validate same-origin requests, accept JSON only, cap request bodies, use bounded upstream timeouts, and disable caching for authenticated GraphQL traffic. Refresh mutations require the matching server-only `ADMIN_AUTH_ACTION_SECRET` or `TENANT_AUTH_ACTION_SECRET`; never send these secrets to browser code or pass them through general GraphQL requests.

### Queries

- `me`
- `platformDashboard` (SuperAdmin / `ADMIN_CONSOLE`)
- `tenantDashboard` (sub-tenant session only)
- `subTenants` (SuperAdmin)
- `subTenant` (SuperAdmin), `tenantByHostname` (public identity lookup only)
- `mainTenantUsers` / `mainTenantUser` (SuperAdmin — MAIN SUPERADMIN memberships)
- `tenantUsers` (sub-tenant scoped)
- `validateActivationToken` / `validatePasswordResetToken`

### Mutations

- `login` / `verifyLoginTotp` / `verifyTotpEnrollment` / `verifyRecoveryCode` / `logout`
- `refreshSession`
- `completeActivation` / `completeActivationTotp` / `completePasswordReset`
- `generatePasswordResetLink` (sub-tenant target; SuperAdmin only)
- `generateMainTenantUserPasswordResetLink` / `generateMainTenantUserActivationLink`
- `createSubTenant` / `setSubTenantStatus`
- `createAdminUser` (sub-tenant invite + activation URL)
- `createMainTenantUser` / `updateMainTenantUser` / `deleteMainTenantUser`

Keep one GraphQL SDL + resolvers map; do not put business logic in resolvers. Resolvers should call domain services under `src/modules/*`.

### GraphQL field selection and data efficiency

- GraphQL operations must request only the fields that the consuming screen/action uses. Avoid broad reusable selections that pull fields “just in case”; use small named fragments only when the same fields are genuinely reused.
- GraphQL returns only selected response fields, but this alone does **not** prevent a resolver from over-fetching from PostgreSQL. Read services must use Prisma `select` projections for fields needed to construct the result; avoid `include: { relation: true }` and full-model reads on list paths.
- Never load password hashes, TOTP secrets, recovery codes, or other credentials for display/list queries. For a boolean such as `totpEnabled`, select only the relevant `enabledAt` field.
- Keep filtering, authorization, ordering, and pagination in the server query. Preserve tenant scoping independently of the requested projection.
- A GraphQL field’s omission from a client operation must never be treated as authorization. Server authorization and field-level data safety remain mandatory.
- For list screens, use bounded pagination and a small explicit projection. If a resolver serves materially different projections, use purpose-specific reads or a justified typed selection-aware projection; do not introduce generic reflection that weakens typing or tenant guards.
- After changing SDL or operation documents, regenerate frontend types and keep generated artifacts in sync.

The Main Console and tenant user list services follow this rule: they explicitly project display fields and do not fetch credential material.

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

The read-only analytics scopes, sources, UTC periods, and unsupported metrics are documented in [ANALYTICS.md](./ANALYTICS.md).

| Concern | Approach |
| --- | --- |
| Validation | Shared Zod schemas at service boundary |
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
5. **GraphQL as the only client contract** for admin/tenant apps
6. **UI authorization is cosmetic; server authorization is mandatory**

## What not to do yet

- Separate auth microservice
- Event-driven choreography between many services
- Duplicate business rules in each frontend
- Building full RBAC matrix before SUPERADMIN + ADMIN/EDITOR isolation is working end-to-end
