# Delivery Roadmap

Build in thin vertical slices. Prefer one working path (login → scoped data) over many unfinished screens.

## Phase 0 — Foundations

- [x] Document product, roles, architecture, stack (`docs/`)
- [x] Lock stack choices (see `TECH-STACK.md` + `SETUP.md`)
  - DB: PostgreSQL 16
  - ORM: Prisma 6
  - GraphQL server: GraphQL Yoga + SDL
  - GraphQL client: Apollo Client
  - Validation: Zod
  - Auth: bcryptjs + jose HTTP-only cookies
- [x] Install locked packages + Docker Postgres (`SETUP.md`)
- [x] Define first Prisma schema for `Tenant`, `User`, `AuditLog`
- [x] Singleton main tenant via migration + seed SuperAdmin only

## Phase 1 — Auth & tenancy core (server)

- [x] Register GraphQL endpoint
- [x] Login / logout / `me`
- [x] Password hashing + session cookies
- [x] Role + tenant context on every request
- [x] `requireAuth` / `requireRole` / `requireTenantAccess` (via service guards)
- [x] Reject SuperAdmin on invalid tenant type pairing
- [x] Create/list/update sub-tenants (SuperAdmin, remote manage only)
- [x] Create Admin users
- [x] Audit log writes on privileged mutations

## Phase 2 — Management console shell (`cube-core-admin`)

- [x] Login page
- [x] Auth-aware layout (shadcn sidebar, tenant/role badge)
- [x] SuperAdmin dashboard
- [x] Tenants create/suspend from dashboard (full directory page later)
- [x] Admins create from dashboard (full directory page later)
- [x] Admin dashboard + recent users (own tenant)
- [ ] Settings + audit full pages (placeholders + dashboard feeds exist)
- [x] Brand tokens + shared dashboard components
- [ ] Forbidden / suspended dedicated pages

## Phase 3 — Tenant app MVP (`cube-core-tenant`)

- [x] Tenant Admin/Editor auth path (`LoginAudience.TENANT_APP`, SuperAdmin rejected)
- [x] Tenant dashboard + shadcn sidebar shell (branded)
- [x] Suspended-tenant blocking (auth service)
- [ ] Basic profile/settings full module (placeholder pages exist)

## Phase 4 — Website (`cube-core-website`)

- [ ] Landing page explaining Cube Core
- [ ] CTAs to admin/tenant login
- [ ] Shared brand tokens with console where useful

## Phase 5 — Hardening

- [ ] Authz test suite for permission matrix
- [ ] Rate limiting on login
- [ ] Structured logs + request ids
- [ ] Backup/restore notes for PostgreSQL
- [ ] Basic staging deploy for all four apps

## Definition of done for “v1 usable”

1. SuperAdmin can create a sub-tenant and an Admin.
2. That Admin can log in and only see their sub-tenant data.
3. SuperAdmin cannot log in to that sub-tenant (console session or tenant app).
4. Suspended sub-tenant blocks Admin access.
5. Audit log records create/suspend/user changes.
6. Admin UI and server agree on the two-role model (no hidden third console role).
