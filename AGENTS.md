# Cube Core Server

GraphQL-only Node service (Yoga on `/graphql`). Domain logic lives in `src/modules/*`.

Canonical docs: `docs/ARCHITECTURE.md`, `docs/ROLES-AND-TENANCY.md`, `docs/TECH-STACK.md`, `docs/AUTH-2FA.md`.

Do **not** add Next.js `app/` routes or REST `/auth` / `/api` handlers — expose operations through GraphQL SDL + resolvers only.

## GraphQL field selection and efficient reads

- Frontend GraphQL operations request only fields their screen/action uses; avoid broad “just in case” selections.
- GraphQL limits the response shape, but does not automatically limit Prisma/database reads. Read services must use explicit Prisma `select` projections and avoid full-model `include: true` on list paths.
- Never fetch password hashes, TOTP secrets, recovery codes, or other credentials for display/list queries. Select only `enabledAt` when the UI needs a 2FA-enabled boolean.
- Keep authorization, tenant scoping, filtering, ordering, and bounded pagination enforced server-side regardless of requested fields.
- Omitted GraphQL fields are not authorization. For materially different projections, use purpose-specific reads or a justified typed selection-aware projection; do not add generic reflection that bypasses type/tenant safeguards.
- Follow `docs/ARCHITECTURE.md` → “GraphQL field selection and data efficiency” and keep this rule in sync.
- The current roles are MAIN `SUPERADMIN` and SUB `ADMIN` / `EDITOR`; do not reintroduce `AUTHOR` without an explicit architecture change.
