# Tenant domain routing

Cube Core stores optional `MANAGEMENT` and `WEBSITE` hostname mappings in `tenant_domains`. Each mapping points to the existing tenant UUID and has its own lifecycle status and ownership-verification timestamp. Saving a mapping does not configure DNS, a hosting project, or a TLS certificate.

Domain state is independent from tenant account state:

- `PENDING_VERIFICATION`: hostname is saved, but its DNS TXT ownership challenge has not passed.
- `PENDING_DNS`: ownership passed; the custom hostname still needs DNS routing, hosting attachment, and valid HTTPS.
- `ACTIVE`: a SuperAdmin confirmed the correct shared app and valid HTTPS after the TXT check. Only this state participates in production tenant routing.
- `ERROR`: reserved for a failed provider/routing check when an integration is configured.
- `DISABLED`: hostname was removed; it is not routable.

The Main Console generates a random DNS TXT challenge at `_cube-core-verification.<hostname>`. The value is public DNS data, not an authentication credential. The server checks the exact TXT response and stores the verification timestamp; domain edits/disconnection reset verification. A domain does not become active just because its value was saved.

## Hosting setup

For each tenant, configure the management hostname on the shared `cube-core-tenant` deployment and the public hostname on the shared `cube-core-website` deployment. At the DNS provider, add the TXT record shown in Tenant Management, then point each hostname to the target hosting provider using the A/AAAA or CNAME record that provider documents. Add each custom hostname to the corresponding hosting project and complete its HTTPS/TLS verification. Only then use the explicit Connect domain action. Test the exact custom hostname and confirm it serves the correct app and tenant before confirming.

The reverse proxy or hosting platform must preserve the incoming `Host` value to the Next.js app. It must remove client-supplied `X-Forwarded-Host` values before writing its own forwarding headers. The apps do not use `X-Forwarded-Host` for tenant resolution. The tenant GraphQL BFF derives the management hostname from the incoming host and sends it to the GraphQL server only as a consistency check; the signed session and its membership remain the authorization authority.

Set `TENANT_APP_URL` in `cube-core-server` and `NEXT_PUBLIC_APP_URL` in `cube-core-tenant` to the same shared tenant-app base URL. That hostname is the optional-domain fallback for local development and shared deployments, and must not be assigned as one tenant's dedicated management domain. `GRAPHQL_SERVER_URL` must point both frontend apps to the same Cube Core GraphQL server. Do not hardcode production tenant domains in source or deployment config.

The website resolves only `WEBSITE` mappings. The tenant app resolves only `MANAGEMENT` mappings. Unknown, inactive, deleted, or suspended website mappings return the same not-found response. Login to an unknown custom management host is rejected. On the shared configured app URL or localhost, `/login` requires an explicit active tenant slug; the server resolves that slug and checks credentials against an active membership in the selected tenant. A slug never grants access by itself.

## Current product limitation

The server currently has no tenant-owned public content model or public content GraphQL operations. A configured website therefore resolves the tenant and shows its name with an unpublished-content message. Publishing pages, media, or other tenant content requires a separate content-model and public-query feature with server-enforced tenant scoping and publication checks.

## Applying mappings

Apply the tenant-domain lifecycle migration before configuring hostnames. Then create or edit a sub-tenant in the Main Console, save its management and/or public hostname, and open Tenant details → Setup for that domain. Generate and publish the TXT ownership record, check DNS, configure the hostname in the appropriate shared hosting project, verify TLS and correct tenant branding, then explicitly connect it. Domain replacements restart verification; removing a hostname disables its mapping. For local development, continue using the shared tenant app URL; wildcard DNS is not required.
