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

## 2. Install `cube-core-server` packages

From `C:\personal\cube-core-server`:

```bash
npm install graphql graphql-yoga zod @prisma/client bcryptjs jose
npm install -D prisma tsx @types/bcryptjs
npx prisma init
```

Create `.env`:

```env
DATABASE_URL="postgresql://postgres:YOUR_PASSWORD@127.0.0.1:5432/cube-db?schema=public"
AUTH_SECRET="replace-with-long-random-string"
APP_URL="http://localhost:4000"
ADMIN_APP_URL="http://localhost:3001"
TENANT_APP_URL="http://localhost:3002"
```

Dev script ports (set when configuring scripts):

```bash
next dev --port 4000
```

## 3. `cube-core-admin` (main tenant console)

Already installed: Apollo Client, Zod, **shadcn/ui** (Nova / Radix).

```bash
# add more UI pieces as needed
npx shadcn@latest add dialog dropdown-menu table
```

`.env.local`:

```env
NEXT_PUBLIC_GRAPHQL_URL="http://localhost:4000/api/graphql"
NEXT_PUBLIC_APP_URL="http://localhost:3000"
```

Dev: `npm run dev` → port **3000**

## 4. `cube-core-tenant` (sub-tenant app)

Already installed: Apollo Client, Zod, **shadcn/ui** (same preset as admin).

`.env.local`:

```env
NEXT_PUBLIC_GRAPHQL_URL="http://localhost:4000/api/graphql"
NEXT_PUBLIC_APP_URL="http://localhost:3001"
```

Dev: `npm run dev` → port **3001**

## 5. `cube-core-website` (public site)

Already installed: **shadcn/ui** (same preset). No GraphQL in v1.

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

## 7. Next implementation work

1. Add GraphQL Yoga route at `/api/graphql`
2. Wire admin Apollo Client to that endpoint
3. Implement login + role/tenant guards

## Do not install

- drizzle / drizzle-orm
- @apollo/server
- urql
- graphql-request (as primary client)
- pothos / type-graphql
- argon2
- redis (v1)
