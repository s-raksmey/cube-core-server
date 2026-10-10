# Project Setup (locked stack)

Follow this exactly. Stack decisions live in [TECH-STACK.md](./TECH-STACK.md).

## Prerequisites

- Node.js 22+
- npm 10+
- Docker Desktop
- Git

## 1. Start PostgreSQL

```bash
docker run --name cube-core-db ^
  -e POSTGRES_USER=cube ^
  -e POSTGRES_PASSWORD=cube ^
  -e POSTGRES_DB=cube_core ^
  -p 5434:5432 ^
  -d postgres:16
```

On PowerShell, `^` line continuation works in cmd; in PowerShell prefer:

```powershell
docker run --name cube-core-db `
  -e POSTGRES_USER=cube `
  -e POSTGRES_PASSWORD=cube `
  -e POSTGRES_DB=cube_core `
  -p 5434:5432 `
  -d postgres:16
```

Or use Compose from `cube-core-server`:

```powershell
docker compose up -d
```

Host DB port is **5434** (avoids clashes with other local Postgres installs).

## 2. Install and configure `cube-core-server`

From `C:\personal\cube-core-server`:

```powershell
npm ci
```

Create `.env`:

```env
DATABASE_URL="postgresql://cube:cube@127.0.0.1:5434/cube_core?schema=public"
AUTH_SECRET="replace-with-long-random-string"
ADMIN_APP_URL="http://localhost:3000"
TENANT_APP_URL="http://localhost:3001"
WEBSITE_URL="http://localhost:3002"
```

Dev (GraphQL-only Node server on port **4000**):

```bash
npm run dev
```

The GraphQL endpoint is `http://localhost:4000/graphql`. The server exposes no Next.js pages or REST `/auth` or `/api` handlers.

## 3. `cube-core-admin` (main tenant console)

Already installed: Apollo Client, Zod, **shadcn/ui** (Nova / Radix), GraphQL Codegen.

Admin uses the Next.js `src/` layout. Operations live in `src/graphql/*.gql`. After the **server GraphQL SDL** changes (`cube-core-server/src/graphql/schema.graphql`), regenerate admin Apollo types:

```bash
npm run graphql:codegen
```

(Prisma migrations update the database; codegen updates TypeScript from the GraphQL schema — run codegen whenever the SDL or admin `.gql` operations change.)

```bash
# add more UI pieces as needed
npx shadcn@latest add dialog dropdown-menu table
```

`.env.local`:

```env
GRAPHQL_SERVER_URL="http://localhost:4000/graphql"
NEXT_PUBLIC_APP_URL="http://localhost:3000"
```

Dev: `npm run dev` → port **3000**. Apollo calls same-origin `/graphql` (rewritten to the server).

## 4. `cube-core-tenant` (sub-tenant app)

Already installed: Apollo Client, Zod, **shadcn/ui** (same preset as admin). Uses Next.js `src/` layout (`src/app`, `src/components`, `src/lib`).

`.env.local`:

```env
GRAPHQL_SERVER_URL="http://localhost:4000/graphql"
NEXT_PUBLIC_APP_URL="http://localhost:3001"
```

Dev: `npm run dev` → port **3001**

## 5. `cube-core-website` (public site)

Already installed: **shadcn/ui** (same preset). Uses Next.js `src/` layout. No GraphQL in v1.

`.env.local`:

```env
NEXT_PUBLIC_ADMIN_LOGIN_URL="http://localhost:3000/login"
NEXT_PUBLIC_TENANT_LOGIN_URL="http://localhost:3001/login"
```

Dev: `npm run dev` → port **3002**

## 6. Daily commands

```powershell
# from cube-core-server
npm run db:up
npm run dev

# from cube-core-admin   → :3000
# after server GraphQL SDL changes:
npm run graphql:codegen
npm run dev

# from cube-core-tenant  → :3001
npm run dev

# from cube-core-website → :3002
npm run dev
```

Seeded accounts (dev only):

| Role | Email | Password |
| --- | --- | --- |
| SuperAdmin | `superadmin@cube-core.local` | `Password123!` |

- Singleton main tenant `core-super-admin` is created by **migration** (exactly one MAIN tenant; never seeded, never created again).
- Seed creates **only** SuperAdmin. Sub-tenants and Admins are created later through the product.

## Do not install

- drizzle / drizzle-orm
- @apollo/server
- urql
- graphql-request (as primary client)
- pothos / type-graphql
- redis (v1)
