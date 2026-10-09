# Product Overview — Cube Core Platform

## Goal

Build a management platform similar to a classic **management console**, but designed for a **two-level tenant hierarchy**:

1. **Main tenant (`core-super-admin`)** — singleton platform organization, owned by SuperAdmin (created by migration, not seed/UI)
2. **Sub-tenants** — organizations under the main tenant, managed by **Admin** and **Editor**

The console should let privileged users create tenants, manage users, configure settings, and operate the platform safely with clear boundaries between roles.

## What makes this different from a generic management console

| Typical console | Cube Core |
| --- | --- |
| Many overlapping roles | **Three console roles**: `SUPERADMIN`, `ADMIN`, `EDITOR` |
| Flat tenant list | **Hierarchical tenancy**: Main tenant → Sub-tenants |
| One admin UI for everything | Same console UX, **scoped by role + tenant** |
| Optional multi-app split | Explicit apps: **server / admin / tenant / website** |

## Primary actors

### 1. SuperAdmin

- Belongs to the **main tenant (`core-super-admin`)**
- Highest privilege in the platform
- Manages the main tenant and the platform-wide structure under it
- Can create / suspend / configure **sub-tenants**
- Can create / manage **Admin** and **Editor** users remotely
- Can view platform-level audit and system health
- **Cannot log in to a sub-tenant** (no sub-tenant console session, no `cube-core-tenant` login, no impersonation)
- Manages sub-tenants **from the main-tenant console only**, as an outside operator

### 2. Admin (sub-tenant)

- Belongs to a **sub-tenant**
- Full management **inside that sub-tenant only**
- Can manage Admin/Editor users in own tenant
- Can edit sensitive tenant settings
- Cannot see or change other sub-tenants
- Cannot change platform-level or main-tenant settings

### 3. Editor (sub-tenant)

- Belongs to a **sub-tenant**
- Day-to-day editing **inside that sub-tenant only**
- Cannot manage users (no create/disable Admin/Editor)
- Cannot change sensitive tenant settings
- Cannot see or change other sub-tenants

> Note: End users of `cube-core-tenant` are **not** console roles. They are application users of a sub-tenant product surface.

## Product principles

1. **Hard tenancy boundaries** — every query/mutation is scoped by tenant + role.
2. **Least privilege** — Editor < Admin < SuperAdmin; never leak higher powers by UI accident.
3. **One console, role-scoped views** — reuse UI patterns; differ by authorization and data scope.
4. **Server is the source of truth** — GraphQL API enforces rules; UIs never trust themselves.
5. **Start simple** — keep these three roles until real product pressure requires more.

## Feature set (required)

### A. Authentication & session

- Email/password login (or OAuth later)
- Secure session / JWT handling via server
- Role + tenant claims available to the API and console
- Logout, password reset, forced logout on suspend
- Protect routes in admin and tenant apps by session

### B. SuperAdmin — Main tenant (Core Admin)

- View / edit main tenant profile (name, branding, status)
- Create, list, update, suspend, reactivate sub-tenants
- Assign domain / slug / identifier per sub-tenant
- Create and manage Admin and Editor users for sub-tenants
- Reset Admin/Editor credentials / disable accounts
- Platform settings (feature flags, defaults for new sub-tenants)
- Platform-wide audit log (tenant changes, admin actions)
- Basic platform dashboard (tenant count, active admins, recent activity)

### C. Admin — Sub-tenant management

- Sub-tenant dashboard (users, activity, status)
- Manage Admin/Editor users **within their sub-tenant** (invite, disable, change role)
- Update sub-tenant profile settings allowed for Admin (name, locale, branding subset)
- View sub-tenant audit log (own tenant only)
- Manage tenant-level configuration (modules toggles, limits if defined)

### D. Editor — Sub-tenant editing

- Sub-tenant dashboard (read operational status)
- Edit day-to-day content/data inside own sub-tenant
- No user management
- No sensitive settings changes
- Limited audit visibility (own actions / non-sensitive)

### E. Tenant directory & isolation

- Unique tenant slug / code
- Soft-delete or suspend (data retained, access blocked)
- Enforce that Admin APIs only resolve their tenant’s data
- Enforce that SuperAdmin never obtains a sub-tenant login/session
- SuperAdmin management of sub-tenants uses explicit `targetTenantId` on privileged APIs while session stays on main tenant

### F. Management console UX (`cube-core-admin`)

- Shared shell: sidebar, top bar, role/tenant badge
- SuperAdmin always shows **main tenant** identity (never “inside” a sub-tenant)
- SuperAdmin navigation: Tenants, Admins/Editors, Platform Settings, Audit, Dashboard
- Admin navigation: Dashboard, Users, Settings, Audit
- Editor navigation: Dashboard, Content/Operations, limited Settings/Audit
- Tables with search / filter / pagination
- Forms with validation and clear error states
- Empty states and permission-denied pages

### G. Tenant app (`cube-core-tenant`) — MVP surface

- Auth for sub-tenant application users (separate from console Admin if needed)
- **Reject SuperAdmin credentials** on tenant-app login
- Tenant-scoped home / workspace
- Read configuration owned by that sub-tenant
- Clear “wrong tenant / suspended” handling

### H. Website (`cube-core-website`)

- Marketing landing
- Product explanation / CTA
- Links into admin or tenant login (no privileged APIs here)

### I. Platform operations (server)

- GraphQL schema for all console + tenant operations
- Central authorization layer (role + tenant checks)
- Structured logging and audit events
- Health check endpoint
- Environment-based config (dev / staging / prod)

## Out of scope for first version (intentionally)

- Fine-grained RBAC beyond SuperAdmin / Admin / Editor
- Billing / subscriptions
- Multi-main-tenant white-label reseller hierarchy
- Real-time collaboration
- Mobile native apps
- Complex workflow engine

These can be added later without changing the core hierarchy if the tenancy model stays clean.
