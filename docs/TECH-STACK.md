# Tech Stack (locked decisions)

These are **final v1 choices**. Do not swap libraries without an explicit architecture change.

## Platform baseline (already in repos)

| Layer | Choice | Version baseline |
| --- | --- | --- |
| Language | TypeScript | 5.x |
| Framework (frontends) | Next.js App Router | 16.x |
| UI library (frontends) | React | 19.x |
| Styling (frontends) | Tailwind CSS + Cube Core brand tokens | 4.x |
| Brand font (frontends) | **Inter** (local variable font in `public/fonts`) | — |
| Component system (frontends) | **shadcn/ui** (Radix Nova preset) | CLI 4.x |
| Package manager | npm | 10.x |

## Locked backend stack (`cube-core-server`)

| Concern | Choice | Why this one |
| --- | --- | --- |
| Runtime | **Node HTTP** + `tsx` | GraphQL-only process — no Next.js on the server |
| Database | **PostgreSQL** (local Windows or Docker) | Solid relational model for tenants/users/audit |
| ORM | **Prisma 6** | Fastest path to migrations + typed queries for this project |
| GraphQL server | **GraphQL Yoga** | Standalone `/graphql` HTTP endpoint |
| GraphQL schema style | **SDL files** (`*.graphql`) + TypeScript resolvers | Clear API contract; easy to read across apps |
| Validation | **Zod** | Runtime validation at mutation/service boundaries |
| Password hashing | **Argon2id** for new hashes; **bcryptjs** for legacy verification and seed credentials | New hashes use the current memory-hard scheme; existing bcrypt credentials remain verifiable |
| Sessions | **HTTP-only signed cookies via `jose`** | Fits browser consoles |
| IDs | **UUID** | Stable public identifiers |

### Exact server packages

```text
@node-rs/argon2
@prisma/client
bcryptjs
graphql
graphql-yoga
jose
otplib
qrcode
zod
```

Dev:

```text
prisma
tsx
@types/bcryptjs
@types/qrcode
typescript
vitest
eslint
```

`cube-core-server` does **not** use shadcn (API-only).

## Locked frontend stack

All three UI apps use **shadcn/ui**:

| App | UI | GraphQL |
| --- | --- | --- |
| `cube-core-admin` (main tenant console) | shadcn/ui + Tailwind | Apollo Client |
| `cube-core-tenant` (sub-tenant app) | shadcn/ui + Tailwind | Apollo Client |
| `cube-core-website` (public site) | shadcn/ui + Tailwind | None in v1 |

| Concern | Choice | Why this one |
| --- | --- | --- |
| Component system | **shadcn/ui** (`radix-nova` preset) | Ownable components, Radix a11y, consistent across apps |
| Icons | **lucide-react** | Default with Nova preset |
| Class merging | **`cn` utility** (`lib/utils.ts`) | shadcn CLI standard |
| GraphQL client (admin/tenant) | **Apollo Client** | Cache + console table workflows |
| GraphQL operation types (admin) | **GraphQL Code Generator** (`*.gql` → typed documents) | Types stay in sync with server SDL |
| Forms / validation | **Zod** | Same validation language as server |

### shadcn conventions

- Config: `components.json` (preset `nova`, base `radix`)
- Components live in `components/ui/`
- Add components with: `npx shadcn@latest add <name>`
- Theme tokens live in `app/globals.css`
- Do **not** introduce a second UI kit (MUI, Chakra, Ant Design, raw Radix-only app code)

Baseline components already installed in all three UI apps:

```text
button, input, label, card, separator, badge
```

## Locked API conventions

| Topic | Decision |
| --- | --- |
| Public contract | GraphQL only (`/graphql`) |
| Pagination | **Offset pagination** for console tables (`page`, `pageSize`) |
| Date format | ISO-8601 strings |
| Error codes | `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `VALIDATION` |
| Auth actor storage | Cookie session contains `userId`, `role`, `tenantId` |

## Locked local ports

| App | Port |
| --- | --- |
| `cube-core-server` | `4000` |
| `cube-core-admin` | `3000` |
| `cube-core-tenant` | `3001` |
| `cube-core-website` | `3002` |
| PostgreSQL | `5432` (local) |

## Explicitly rejected for v1

Do **not** install or introduce these as alternatives:

- Drizzle (use Prisma)
- Apollo Server (use GraphQL Yoga)
- urql / graphql-request as primary client (use Apollo Client)
- Pothos / TypeGraphQL (use SDL + resolvers)
- Replacing the current Argon2id/bcrypt compatibility setup without an explicit migration plan
- JWT bearer tokens as the primary browser auth (use HTTP-only cookies via `jose`)
- MUI / Chakra / Ant Design / bare custom component kits instead of shadcn
- Redis, NestJS, Express standalone API, microservices
- REST public API beside GraphQL

## Quality bar

- TypeScript strict mode
- ESLint via Next.js config
- No `any` in auth/tenancy code without justification
- Authz tests for the SuperAdmin / Admin / Editor permission matrix
- Migration creates singleton main tenant `core-super-admin`; seed creates SuperAdmin only
