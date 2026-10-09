# Tech Stack (locked decisions)

These are **final v1 choices**. Do not swap libraries without an explicit architecture change.

## Platform baseline (already in repos)

| Layer | Choice | Version baseline |
| --- | --- | --- |
| Language | TypeScript | 5.x |
| Framework | Next.js App Router | 16.x |
| UI library | React | 19.x |
| Styling (frontends) | Tailwind CSS | 4.x |
| Package manager | npm | 10.x |

## Locked backend stack (`cube-core-server`)

| Concern | Choice | Why this one |
| --- | --- | --- |
| Database | **PostgreSQL 16** (Docker locally) | Solid relational model for tenants/users/audit |
| ORM | **Prisma 6** | Fastest path to migrations + typed queries for this project |
| GraphQL server | **GraphQL Yoga** | Simple Next.js Route Handler setup; lighter than Apollo Server here |
| GraphQL schema style | **SDL files** (`*.graphql`) + TypeScript resolvers | Clear API contract; easy to read across apps |
| Validation | **Zod** | Runtime validation at mutation/service boundaries |
| Password hashing | **bcryptjs** | Simple, widely used, enough for v1 |
| Sessions | **HTTP-only signed cookies via `jose`** | Fits browser consoles; no bearer-token sprawl in v1 |
| IDs | **UUID** | Stable public identifiers |

### Exact server packages

```text
graphql
graphql-yoga
@prisma/client
zod
bcryptjs
jose
```

Dev:

```text
prisma
tsx
@types/bcryptjs
```

## Locked frontend stack

### `cube-core-admin` + `cube-core-tenant`

| Concern | Choice | Why this one |
| --- | --- | --- |
| GraphQL client | **Apollo Client** | Cache + console table workflows; one client for both apps |
| Forms / input validation | **Zod** | Same validation language as server |
| UI primitives | **Radix UI** + Tailwind | Accessible controls without a heavy design-system lock-in |

Exact packages (when wiring each app):

```text
@apollo/client
graphql
zod
```

Radix packages install per component need later (dialog, dropdown, etc.).

### `cube-core-website`

| Concern | Choice |
| --- | --- |
| Stack | Next.js + TypeScript + Tailwind only |
| GraphQL | **None in v1** |

## Locked API conventions

| Topic | Decision |
| --- | --- |
| Public API | GraphQL only (`/api/graphql`) |
| Pagination | **Offset pagination** for console tables (`page`, `pageSize`) |
| Date format | ISO-8601 strings |
| Error codes | `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `VALIDATION` |
| Auth actor storage | Cookie session contains `userId`, `role`, `tenantId` |

## Locked local ports

| App | Port |
| --- | --- |
| `cube-core-server` | `4000` |
| `cube-core-admin` | `3001` |
| `cube-core-tenant` | `3002` |
| `cube-core-website` | `3000` |
| PostgreSQL | `5432` (local Windows Postgres; Docker optional on `5434`) |

## Explicitly rejected for v1

Do **not** install or introduce these as alternatives:

- Drizzle (use Prisma)
- Apollo Server (use GraphQL Yoga)
- urql / graphql-request as primary client (use Apollo Client)
- Pothos / TypeGraphQL (use SDL + resolvers)
- Argon2 (use bcryptjs)
- JWT bearer tokens as the primary browser auth (use HTTP-only cookies via `jose`)
- Redis, NestJS, Express standalone API, microservices
- REST public API beside GraphQL

## Quality bar

- TypeScript strict mode
- ESLint via Next.js config
- No `any` in auth/tenancy code without justification
- Authz tests for the SuperAdmin / Admin permission matrix
- Migration creates singleton main tenant `core-super-admin`; seed creates SuperAdmin only
