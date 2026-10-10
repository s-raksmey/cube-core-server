# Cube Core Server

GraphQL API and domain backend for the Cube Core platform. This Node.js service uses GraphQL Yoga at `/graphql`; authentication, tenancy, user management, and authorization live here.

Domain services are organized under `src/modules/*`. GraphQL operations are defined in the single SDL file at `src/graphql/schema.graphql` and implemented by domain-specific resolvers under `src/graphql/resolvers/*`.

## Architecture and setup

- [Software architecture](./docs/ARCHITECTURE.md)
- [Roles and tenancy](./docs/ROLES-AND-TENANCY.md)
- [Tech stack](./docs/TECH-STACK.md)
- [Authentication and 2FA](./docs/AUTH-2FA.md)
- [Local setup](./docs/SETUP.md)

## Local development

```powershell
npm install
npm run db:up
npm run db:migrate
npm run db:seed
npm run dev
```

The GraphQL endpoint is `http://localhost:4000/graphql`. The server does not host Next.js pages or REST `/auth` or `/api` routes.
