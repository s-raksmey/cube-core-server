# Cube Core Server

GraphQL-only Node service (Yoga on `/graphql`). Domain logic lives in `src/modules/*`.

Canonical docs: `docs/ARCHITECTURE.md`, `docs/ROLES-AND-TENANCY.md`, `docs/TECH-STACK.md`, `docs/AUTH-2FA.md`.

Do **not** add Next.js `app/` routes or REST `/auth` / `/api` handlers — expose operations through GraphQL SDL + resolvers only.
