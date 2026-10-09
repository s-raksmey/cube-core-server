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

- [ ] Register GraphQL endpoint
- [ ] Login / logout / `me`
- [ ] Password hashing + session cookies
- [ ] Role + tenant context on every request
- [ ] `requireAuth` / `requireRole` / `requireTenantAccess`
- [ ] Reject SuperAdmin on any sub-tenant login path
- [ ] Create/list/update sub-tenants (SuperAdmin, remote manage only)
- [ ] Create/list Admin users
- [ ] Audit log writes on privileged mutations

## Phase 2 — Management console shell (`cube-core-admin`)

- [ ] Login page
- [ ] Auth-aware layout (sidebar, tenant/role badge)
- [ ] SuperAdmin dashboard
- [ ] Tenants list + create/edit/suspend
- [ ] Admins management
- [ ] Admin dashboard + users list (own tenant)
- [ ] Settings + audit pages (role-scoped)
- [ ] Forbidden / suspended states

## Phase 3 — Tenant app MVP (`cube-core-tenant`)

- [ ] Tenant user auth path (even if simple)
- [ ] Tenant home using server config
- [ ] Suspended-tenant blocking
- [ ] Basic profile/settings read

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
