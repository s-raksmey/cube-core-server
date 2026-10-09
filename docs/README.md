# Cube Core — Documentation

This folder defines the product vision, multi-tenant model, features, and software architecture for the Cube Core platform.

## Documents

| Doc | Purpose |
| --- | --- |
| [PRODUCT.md](./PRODUCT.md) | Product goal, actors, and feature set |
| [ROLES-AND-TENANCY.md](./ROLES-AND-TENANCY.md) | SuperAdmin / Admin model and tenant hierarchy |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | System design, repo responsibilities, data flow |
| [TECH-STACK.md](./TECH-STACK.md) | Locked library/framework decisions |
| [SETUP.md](./SETUP.md) | Exact install + env + port setup |
| [ROADMAP.md](./ROADMAP.md) | Suggested build phases |

## Workspace apps

| Repo | Role |
| --- | --- |
| `cube-core-server` | GraphQL API, domain logic, auth, persistence |
| `cube-core-admin` | Management console UI (SuperAdmin + Admin) |
| `cube-core-tenant` | Sub-tenant facing application |
| `cube-core-website` | Public marketing / landing site |

## Status

These repos are currently Next.js scaffolds. Treat this `docs/` folder as the source of truth until implementation catches up.
