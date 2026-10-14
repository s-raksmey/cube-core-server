# Tags management implementation

Tags use the existing Category service/resolver architecture and the shared tenant permission system. GraphQL operations are `tags`, `tag`, `createTag`, `updateTag`, and `deleteTag`. Reads select only display fields, scope every search branch to the authenticated SUB tenant, and use bounded offset pagination (25 by default, maximum 100).

`Tag.name` stores the default English name. Optional `TagTranslation` rows store additional normalized locales only; English, duplicate locales, empty names, and invalid slugs are rejected. Tag slugs are unique per tenant. Translation updates replace the supplied list atomically; omitting translations preserves them and supplying an empty list removes them.

Permissions follow existing names: `TAG_VIEW`, `TAG_CREATE`, `TAG_EDIT`, `TAG_DELETE`. Management permissions require view permission. Existing Editor policy permits view only. Server resolvers always require a session and services enforce configured permissions and tenant ownership.

The tenant route `/content/tags` provides search, pagination, create/edit translation dialogs and deletion confirmation using the same primitives and styling as Categories. Supported languages come from `src/lib/locales.ts`. The current Categories implementation has neither a shared translation input component nor a toast system; Tags uses the same inline error approach and adds accessible success feedback.

Articles currently have no implemented service or form. A minimal Article model and ArticleTag join establish the requested relational foundation. Composite foreign keys include tenant UUID on both sides, preventing cross-tenant attachment at the database level. Deleting a tag cascades only its translations and join rows, preserving articles. Article CRUD and the article selector remain part of the future Article module.

Migrations: `20261014120000_add_tags` and `20261014130000_add_article_tag_relations`. The Tags migration was already applied in the local database; the ArticleTag migration was applied and verified during this task. Apply both through the normal deployment workflow in other environments.

Files created/extended from the existing partial implementation:
- Server: `src/modules/tenants/tag.service.ts`, `src/graphql/resolvers/tenants/tenants-tags-resolver.ts`, both migration directories, `tests/modules/tenants/tag.service.test.ts`, `tests/modules/tenants/tag.database.test.ts`, and this document.
- Tenant: `src/components/content/tags-panel.tsx`, `src/hooks/use-tenant-tags.ts`, `src/graphql/tags.gql`.

Modified files:
- Server: `prisma/schema.prisma`, `prisma/seed.ts`, `src/graphql/schema.graphql`, `src/graphql/resolvers/tenants/index.ts`, `src/modules/roles/role-permission.service.ts`.
- Tenant: `src/app/(workspace)/content/tags/page.tsx`, `src/components/dashboard/app-sidebar.tsx`, `src/components/roles/tenant-role-permissions-panel.tsx`, `src/hooks/use-tenant-user-permissions.ts`, `src/types/role-permission.types.ts`, `src/lib/apollo/operations.ts`, generated GraphQL files.
- Admin: `src/types/role-permission.types.ts`, `src/components/roles/role-management-panel.tsx`, generated GraphQL types. Tag permissions can be configured alongside category permissions using the existing matrix and dependency rules.

Verification:
- Prisma validation and standard client generation passed; local migration deployment passed.
- 16 Tag validation/service/permission tests passed.
- 6 opt-in real PostgreSQL tests passed, with temporary tenants cleaned up afterward.
- Full server suite: 98 passed, 3 unrelated tenant-domain branding-projection expectation failures.
- Server TypeScript build passed. Server lint remains blocked by its existing ESLint configuration ignoring all TypeScript files.
- Tenant GraphQL codegen, typecheck, lint, and production webpack build passed. Default Turbopack build fails in its CSS child-process startup, including outside the sandbox.
- Admin GraphQL codegen, typecheck and lint passed.
- Diff whitespace checks passed in all changed repositories.

Database tests can be run with `RUN_TAG_DATABASE_TESTS=1` and the local `.env` database settings. They verify actual unique constraints, composite foreign keys, search and cascading relationship deletion. Browser visual inspection was not performed.
