# List search across Cube Core

Implemented 2026-10-31. The repositories are `cube-core-server`, `cube-core-admin`,
`cube-core-tenant`, and `cube-core-website` (the public website called
`cube-core-web` in the request). The backend is a Node/Yoga service, not a Next.js
application. All matching happens through GraphQL `/graphql` and Prisma/PostgreSQL.

## Audit and architecture

The audit covered SDL, resolvers, domain services, Prisma relationships and indexes,
authorization helpers, hostname/local-development tenant resolution, client
operations, hooks, and all three codegen configurations. Existing operation names
and module boundaries are preserved.

Before this change, every target resource already had a backend search argument.
Gaps were tenant-domain matching, managed-user username matching, inconsistent
validation/defaults, missing stable ordering on some user/tenant lists, unbounded
categories/subcategories, and missing tag totals. Public search already had a
`/search?q=...` route and `publicWebsiteArticles`; it matched summary instead of
slug. The public website resolves identity from the incoming Host header, including
the existing localhost development assignment.

No reusable backend pagination validator existed for these services. Shared Zod
schemas and offset calculation now live in `src/lib/search.ts`. Domain-specific
filters, projections, permissions and ordering stay in their read services.

## Search contract

| Resource | GraphQL query | Matching fields |
| --- | --- | --- |
| Admin sub-tenants | `subTenants` | Tenant name, slug, related domain hostname, both purposes |
| Main users | `mainTenantUsers` | First name, last name, email, username |
| Selected tenant users | `subTenantUsers` | First name, last name, email, username |
| Tenant articles | `articles` | Title, slug, translated titles |
| Categories | `categories` | Stored name, slug, translated names |
| Subcategories | `subcategories` | Slug, translated names (including the English name; no separate name column exists) |
| Tags | `tags` | Name, slug, translated names |
| Tenant users | `tenantUsers` | First name, last name, email, username |
| Public news | `publicWebsiteArticles` | Title, slug, translated titles |

Matching is case-insensitive substring matching. Fields combine with OR; tenant,
visibility, permissions and selected filters combine with AND. Translations are
searched across locales, including Khmer, independently of the selected UI locale.
Article content and summary are not searched.

Search text is trimmed, limited to 160 characters, and empty/null text means no
text filter. Page defaults to 1; page size defaults to 25 and is limited to 100.
Pages must be integers between 1 and 100000. Explicit null pagination uses defaults.
Invalid values return the normal GraphQL `VALIDATION` error; oversized page sizes
are rejected instead of silently clamped. Clients can still request smaller pages.

Each page returns `items`, `total`, `page`, and `pageSize`. The same scoped `where`
object drives `findMany` and `count`. Every list has a unique UUID tie-breaker.
No `totalPages` field was added; clients calculate it.

## Schema changes and rollout

```graphql
categories(search: String, page: Int, pageSize: Int): CategoryPage!
subcategories(categoryId: ID, search: String, page: Int, pageSize: Int): SubcategoryPage!
tags(search: String, page: Int, pageSize: Int): TagPage!
```

`CategoryPage`, `SubcategoryPage` and `TagPage` use the common page shape above.
These are breaking return-shape changes from arrays. Deploy the server and tenant
client together; other consumers must move their selections and accessors under
`items`. Existing user/article page names, including `ManagedSubTenantUserPage`,
are retained.

`publicWebsiteArticles` now requires `hostname: String!` in addition to its existing
tenant ID and filters. Its default page size is 25. The domain service resolves the
WEBSITE mapping, verifies the supplied tenant ID agrees, and searches using the
resolved identity. Localhost uses the existing assignment only outside production.
The website adds the hostname from server-side request headers; URL parameters do
not supply tenant identity. Update other callers to provide their resolved website
hostname. Category/subcategory/tag slug filters are preserved rather than replaced
with duplicate ID-based operations.

## Authorization and projections

Admin searches require a MAIN SuperAdmin session. Selected-sub-tenant user reads
also retain `USERS_VIEW`, validate the target UUID and require an existing SUB
tenant. Tenant reads retain their operation permissions and derive tenant identity
from the signed session. Tenant user search explicitly rejects MAIN sessions.

Article `MY` adds ownership; `REVIEW` requires review permission and adds IN_REVIEW
status. A contradictory submitted status returns no matches instead of overriding
the status filter. Normal list visibility is preserved.

Public reads retain active-tenant validation and the normal visibility predicate:
PUBLISHED status and `publishedAt <= now`. Drafts, review, archived, scheduled and
future-published articles cannot appear. Editorial fields are excluded from public
summary projections.

List reads use explicit Prisma `select`. User display reads never fetch passwords,
TOTP secrets, recovery codes or token secrets; where needed they select only 2FA
`enabledAt`. Existing activation-state timestamps remain available without token
values. Category list child previews are bounded to 100 per category and permission
filtered; the separate paginated subcategory search reaches the full dataset.

## Frontend behavior

Admin tenant/main-user/selected-tenant-user lists keep their existing backend search
forms, loading/error/empty states and page controls. Page sizes are now 25 and
search inputs have the 160-character limit.

Tenant article/category/tag/user lists submit trimmed search on Search or Enter,
reset the page on search/filter changes, and preserve submitted search during
pagination. Categories and tags now use backend totals. The Categories screen adds
subcategory search, parent filtering, edit/delete actions and separate pagination.
Category/subcategory pickers use backend search and paging so records beyond page
one remain selectable. No result matching is performed on loaded frontend arrays.

Apollo query variables include the submitted search and filters; the current
observable follows those variables rather than assigning asynchronous results to
shared state. No cross-variable pagination merge policy was introduced. Console
search state remains in hooks; URL synchronization was not added to existing
console lists. Public search keeps shareable `q` and `page` URL parameters.

The website reuses StoryArchive and existing cards for images, titles, categories,
publication dates and summaries. The results page adds an inline GET search form,
validation feedback and service-error feedback, retaining the Suspense loading
state and pagination. Clearing the public query returns the existing empty-search
state. Search text and page are validated rather than silently truncated/clamped.

## Tests and verification

New tests:

- `tests/lib/search.test.ts`: normalization, Khmer, null/defaults, length and paging boundaries.
- `tests/modules/search-contract.test.ts`: every resource projection/search branch,
  shared counts, stable ordering, filter combinations, permission rejection,
  MAIN/SUB isolation, review scope, public visibility predicates and hostname binding.
- `tests/modules/search.database.test.ts`: opt-in PostgreSQL integration coverage
  for real field matching, English/Khmer translations, all user fields, both domain
  purposes, filters, totals, pages, ownership, public visibility and tenant isolation.

Existing tag mocks and public-page-size expectations were updated for the new contract.
The database suite requires a migrated, seeded test database with normal role
permissions and cleans up only its UUID-scoped fixtures:

```powershell
$env:RUN_SEARCH_DATABASE_TESTS = "1"
npm test -- tests/modules/search.database.test.ts
```

The normal test run leaves database suites skipped unless explicitly enabled.
Verification results and the complete file inventory are recorded below.

## Operational limits

No Prisma schema changes or migrations are needed. Existing tenant/status/date and
relationship indexes were reviewed. Ordinary B-tree indexes do not generally
accelerate arbitrary substring patterns; realistic-data latency and query-plan
measurements remain necessary before choosing additional indexes. No external
search infrastructure, fuzzy matching, body search, autocomplete, or global search
operation was added.

The public website still uses the existing server fetch timeout and no-store
policy. The current public read architecture and tenant/domain routing are retained.

## Verification results

| Command | Repository | Result |
| --- | --- | --- |
| `npm run graphql:codegen` | Admin, tenant, website | Passed; generated operation types updated where changed |
| `npm run build` | Server | Passed (`tsc --noEmit`, including tests) |
| `npm run typecheck` | Admin, tenant, website | Passed |
| `npm run lint` | Admin, tenant | Passed |
| `npm run lint` | Website | Passed with two unused eslint-disable warnings in generated files |
| `npm run lint` | Server | Existing ESLint configuration ignores all TypeScript source files; command cannot run |
| `npm test` | Server | 305 passed, 34 skipped; skipped tests are opt-in database suites |
| `npm run build` | Admin, tenant, website | Turbopack CSS worker exits before connection, including outside the sandbox |
| `npm run build -- --webpack` | Admin, tenant, website | Passed outside the sandbox; initial sandbox attempts hit `.next` mkdir EPERM |
| `git diff --check` | All four repositories | Passed |

No formatting script is configured in these projects. No dependency or package
manifest changes were made for search; pre-existing package/lockfile edits were
left in place. PostgreSQL was not reachable on localhost:5434 and `docker compose ps` could not
connect to the Docker Desktop engine, so the new six-test
PostgreSQL suite remains unexecuted, alongside the existing opt-in database suites.
Real-data performance measurements and authenticated browser interaction checks
remain unverified. Console URL-state persistence is a possible future improvement.

## File inventory

Paths are relative to each named repository. Generated files were produced by
codegen rather than edited manually.

### cube-core-server

Created:

- `docs/SEARCH.md`
- `src/lib/search.ts`
- `tests/lib/search.test.ts`
- `tests/modules/search-contract.test.ts`
- `tests/modules/search.database.test.ts`

Modified:

- `src/graphql/resolvers/public-website-resolver.ts`
- `src/graphql/resolvers/tenants/tenants-categories-resolver.ts`
- `src/graphql/schema.graphql`
- `src/modules/articles/article.service.ts`
- `src/modules/articles/public-article.service.ts`
- `src/modules/tenants/category.service.ts`
- `src/modules/tenants/tag.service.ts`
- `src/modules/tenants/tenant-user-query.service.ts`
- `src/modules/tenants/tenant.service.ts`
- `src/modules/users/main-user-query.service.ts`
- `tests/modules/articles/public-article-discovery.test.ts`
- `tests/modules/tenants/tag.service.test.ts`

### cube-core-admin


Modified:

- `src/components/dashboard/search-toolbar.tsx`
- `src/components/tenants/tenant-management-panel.tsx`
- `src/components/users/user-list-toolbar.tsx`
- `src/hooks/use-main-tenant-users.ts`
- `src/hooks/use-managed-tenant-users.ts`
- `src/hooks/use-sub-tenants.ts`

### cube-core-tenant

Created:

- `src/components/content/taxonomy-picker.tsx`
- `src/hooks/use-taxonomy-picker.ts`

Modified:

- `src/components/content/article-editor.tsx`
- `src/components/content/articles-list.tsx`
- `src/components/content/categories-panel.tsx`
- `src/components/content/tags-panel.tsx`
- `src/components/users/tenant-user-list-toolbar.tsx`
- `src/graphql/articles.gql`
- `src/graphql/categories.gql`
- `src/graphql/tags.gql`
- `src/hooks/use-article-editor.ts`
- `src/hooks/use-tenant-articles.ts`
- `src/hooks/use-tenant-categories.ts`
- `src/hooks/use-tenant-tags.ts`
- `src/hooks/use-tenant-users.ts`
- `src/lib/apollo/generated/gql.ts`
- `src/lib/apollo/generated/graphql.ts`
- `src/lib/apollo/operations.ts`

### cube-core-website


Modified:

- `src/app/(site)/search/page.tsx`
- `src/components/site/story-archive.tsx`
- `src/graphql/public-content.gql`
- `src/lib/apollo/generated/gql.ts`
- `src/lib/apollo/generated/graphql.ts`
- `src/lib/public-content.ts`

## Frontend integration follow-up

Verified the existing route-to-component-to-hook-to-GraphQL connections for:

- Admin: sub-tenants, Main Tenant users, selected sub-tenant users.
- Tenant: articles, categories, subcategories, tags, users and organization pickers.
- Website: header search, `/search?q=...&page=...`, cards and page links.

Submitting the same normalized search on page one now refetches the backend, so
Search/Enter can retry a failed request or refresh current results. Changed search
still resets to page one. Query errors continue to appear through the existing
Apollo error states. Admin tenant edits refetch the current observable variables
rather than restoring search/page values captured before the mutation.

The public header search now permits empty submission to clear the search and
uses an accessible search input. Its modified file is
`cube-core-website/src/components/site/site-header.tsx` in addition to the earlier
inventory. No additional SDL or operation changes were needed for this follow-up.
All three frontend type checks passed; live authenticated verification still needs
the backend and PostgreSQL running.
