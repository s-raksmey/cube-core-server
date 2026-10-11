# Cube Core Technology Architecture Audit

**Reviewed:** 2026-10-11  
**Repositories:** `cube-core-server`, `cube-core-admin`, `cube-core-tenant`, `cube-core-website`

This audit is based on the checked-in implementation and project configuration. It does not claim production readiness; no production database query plans, load tests, or deployed edge configuration were available.

## What is implemented well

- **Modular monolith:** GraphQL Yoga is the single server entry point, SDL is canonical in `src/graphql/schema.graphql`, resolvers are split by domain/operation, and business logic is in `src/modules/*`. Prisma access stays in the services; introducing repositories everywhere would add indirection without improving these call paths.
- **Prisma and tenancy:** unified users, role assignments, memberships, and sessions are modeled with foreign keys, unique constraints, and indexes. Services enforce MAIN/SUB scope and role rules. Multi-step user creation is transactional. Existing transactions and database constraints are appropriate; no schema or migration change was needed for this audit.
- **Read shaping:** main/tenant user lists and platform dashboard reads use explicit projections and bounded pagination. UI list projections avoid credential fields; 2FA indicators use `enabledAt` only. The tenant dashboard recent-user read and tenant-user removal lookup were additional broad relation reads and have now been changed to explicit `select` projections.
- **Runtime validation:** Zod validates important service inputs such as login, activation, user creation/update, tenant creation, pagination, and password reset. GraphQL scalar/enum validation handles basic GraphQL type constraints. The schemas are feature-specific and do not show conflicting duplicated rules that warrant a shared global schema layer.
- **GraphQL contract and codegen:** all frontends generate typed documents from the server SDL and their checked-in `.gql` operations. Generated output is treated as generated code. Generation succeeds without production credentials. Website currently has no operations, so its successful codegen is a scaffold/no-document run rather than evidence of a consumed API operation.
- **Browser session boundary:** admin and tenant Apollo clients call same-origin `/graphql`; access/refresh tokens live in HttpOnly cookies and are forwarded server-side. Admin already applied request origin/content-type/body-size checks, timeouts, no-store behavior, and refresh-token coalescing.
- **Technology choices:** Prisma, Zod, Yoga, Apollo Client, and GraphQL Code Generator fit the existing architecture. There is no evidence supporting a server-framework migration or a replacement of these libraries.

## Confirmed findings and actions

| Priority | Finding | Action / status |
| --- | --- | --- |
| P1 | Tenant BFF refresh omitted `TENANT_AUTH_ACTION_SECRET`, although `auth-refresh-session-resolver.ts` requires it. Refresh therefore failed authorization when an access token expired. The handler also lacked bounded body reads/timeouts, consistent cache controls, and terminal stale-cookie clearing. | Fixed in tenant `src/app/graphql/route.ts`: attach the secret only to the server-to-server refresh request, validate same-origin JSON, enforce a 1 MB body cap, set 15-second upstream timeouts, disable caching, clear cookies on terminal refresh errors, and preserve cookies on transient upstream failures. |
| P1 | The GraphQL server relied on Yoga's default 25 MB request-body limit. | Set an explicit 1 MB server-side parser limit in `src/index.ts`. Query depth/cost and per-client request-rate protections are still not configured; add these before exposing the endpoint to untrusted production traffic, preferably at the gateway plus a tested GraphQL validation limit. CORS is not a substitute for those controls. |
| P2 | Tenant dashboard recent-user reads and tenant-user removal loaded complete related `User` and `Role` rows using `include`. | Fixed with purpose-specific Prisma `select` projections in `src/modules/dashboard/dashboard.service.ts` and `src/modules/tenants/tenant.service.ts`. |
| P2 | Shared architecture guidance still described the tenant role set as including `AUTHOR`. | Corrected the stale server Cursor rule to match the current `SUPERADMIN` / `ADMIN` / `EDITOR` model. The AUTHOR migration and test cases remain as historical migration/security regression artifacts; they do not re-enable the role. |
| P2 | Admin and tenant declared Zod as a direct runtime dependency without importing it in application source; admin also declared `@graphql-codegen/import-types-preset`, which its codegen config does not use. | Removed those direct declarations from the corresponding `package.json` and lockfile root metadata. Zod remains a server dependency; frontend tooling may still resolve it transitively. |
| P2 | Server `npm run lint` is currently nonfunctional: `eslint.config.mjs` only declares global ignores, so ESLint 9 reports every `src` file ignored. The server has no TypeScript ESLint parser installed. | Not changed: installing/configuring a TypeScript ESLint parser could not be completed because npm offline resolution failed on an uncached optional package. `npm run build` remains the available TypeScript check. |
| P3 | Codegen preset `ignoreNoDocuments: true` allows website generation to succeed with no operations. | Kept intentionally because the website currently has no GraphQL operation. Once the first public operation exists, it should be generated and typechecked; consider requiring documents after that. |

## Area-by-area assessment

### Prisma

Queries live in domain/application services rather than repeated resolver bodies. Membership and user reads include tenant predicates and bounded `take`/pagination. Unique identity constraints and relation constraints provide important integrity protection. The schema has useful single-column and relation indexes; whether composite indexes or trigram indexes are needed depends on real data volume and PostgreSQL `EXPLAIN (ANALYZE, BUFFERS)` results. Do not add them based on guesses.

Several `include` calls remain in credential verification, activation, and password/session workflows where the related data is required to authenticate or mutate an account. Those are not display/list projections. Do not reuse them in UI reads.

### Zod

The server validates untrusted input in service boundaries. Admin and tenant no longer declare Zod directly because their application source did not use it; tooling can still install Zod transitively. Do not rely on client validation for server security.

### GraphQL

The server SDL is the single contract and resolvers delegate to module services. Auth/tenant rules are enforced server-side. There are no REST business handlers in the server. Request body size is now explicitly bounded. There is no configured depth/complexity budget or shared rate limiter in the inspected code; the operational rate limit for login lockout is account-specific and does not protect the whole endpoint from request floods.

### Apollo Client and Code Generator

Admin and tenant clients use same-origin BFF endpoints with cookie-backed auth; credentials are not exposed in browser storage. Mutation flows generally refetch their relevant lists, which is correct though potentially more expensive than normalized cache updates for high-frequency operations. Admin and tenant codegen read `../cube-core-server/src/graphql/schema.graphql` and their actual operation documents. The website has the same setup but no `.gql` operation yet. No generated files were edited by hand.

## Ranked follow-up recommendations

1. **Before production exposure:** add and test GraphQL depth/complexity validation and endpoint-level rate limits (especially login/challenge mutations); configure equivalent protections at the reverse proxy/WAF.
2. **Improve server static checks:** install a TypeScript-aware ESLint parser/plugin when package registry resolution is available, configure ESLint 9 flat config for `src/**/*.ts` and `prisma/**/*.ts`, then make lint a passing CI check.
3. **Measure before indexing:** capture query plans for tenant user search and dashboard/list queries with representative data. Add composite or trigram indexes only if plans show a real bottleneck.
4. **Website GraphQL:** add codegen/typecheck coverage when the first public read operation is implemented. Until then, treat its no-document codegen run as scaffolding only.

No Prisma, Zod, Yoga, Apollo, or Code Generator replacement is recommended. The only dependency edits remove unused direct frontend declarations; the server dependency set is unchanged.

## Verification

- `npm run build` — server TypeScript check passed after the projection and BFF-related changes.
- `npm test` — server: 10 test files and 28 tests passed.
- `npm run graphql:codegen` — admin, tenant, and website generation completed; website had no operation documents.
- `npm run typecheck` — admin, tenant, and website passed.
- `npm run lint` — admin, tenant, and website completed with warnings only (3, 4, and 2 warnings respectively; primarily internal `window.location.assign()` and generated-file directives). Server lint failed as described above.
- `git diff --check` — passed in all four repositories.

