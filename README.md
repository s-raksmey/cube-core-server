# Cube Core Server

GraphQL API and domain backend for the Cube Core platform.

This service is the **system of record** for authentication, tenancy, users, settings, and audit. Frontends (`cube-core-admin`, `cube-core-tenant`, `cube-core-website`) consume this API.

## Product model (short)

- **SuperAdmin** manages the singleton main tenant (`core-super-admin`) and all **sub-tenants** remotely
- **Admin** manages **one sub-tenant only**
- **SuperAdmin cannot log in to a sub-tenant**
- Console has exactly **two roles** in v1

## Documentation

Start here:

- [docs/README.md](./docs/README.md) — doc index
- [docs/PRODUCT.md](./docs/PRODUCT.md) — goals and feature set
- [docs/ROLES-AND-TENANCY.md](./docs/ROLES-AND-TENANCY.md) — roles and hierarchy
- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) — software architecture
- [docs/TECH-STACK.md](./docs/TECH-STACK.md) — Next.js / TypeScript / Tailwind / GraphQL
- [docs/ROADMAP.md](./docs/ROADMAP.md) — delivery phases

## Workspace

| App | Purpose |
| --- | --- |
| `cube-core-server` | GraphQL API + domain logic |
| `cube-core-admin` | Management console (SuperAdmin + Admin) |
| `cube-core-tenant` | Sub-tenant application |
| `cube-core-website` | Public marketing site |

## Tech stack (locked)

- Next.js + TypeScript + Tailwind (frontends)
- GraphQL Yoga + SDL (this server)
- Prisma + PostgreSQL 16
- Zod, bcryptjs, jose
- Apollo Client (admin / tenant)

See [docs/TECH-STACK.md](./docs/TECH-STACK.md) and [docs/SETUP.md](./docs/SETUP.md).

## Getting started

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Implementation should follow the docs above rather than growing ad-hoc features in the default scaffold pages.
