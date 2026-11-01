# Self-service profile

Both console applications expose `/profile` through the avatar beside Logout.
Edit profile saves first name, last name, optional username, and an optional photo.
Email is displayed read-only; changing a sign-in email requires a separate verified
email-change flow. Roles and workspace assignments are also read-only.

`updateMyProfile(input: UpdateMyProfileInput!): User!` accepts no target user or
tenant ID. The service validates the authenticated audience/role and active user,
membership and tenant. Main SuperAdmins use a MAIN session; tenant Admins and
Editors use their current SUB session. Usernames follow the existing activation
format and are normalized to lowercase. Names and username updates and the audit
entry are written in one transaction. The safe returned user fields update Apollo
cache, including the header avatar, without reloading the session gate.

`User.avatarUrl` exposes the stored avatar path. Session/profile display reads use
an explicit projection that does not retrieve password hashes, TOTP secrets,
recovery codes or authentication token data.

Uploads accept PNG, JPEG and WebP, up to 3000 KB and 16 megapixels. The server
validates extension, MIME type, file signature, encoded size and decoded image.
Sharp applies orientation, crops to 256×256, strips metadata and writes WebP under
`storage/users/<signed-in-user-id>/avatars/<generated-id>.webp`. The database stores
the path in `User.avatarPath`. Old images are removed only within the same user's
avatar directory. Failed transactions remove the new image; a cleanup failure
after a successful save does not turn the save into an error.

The client offers image preview, replacement, removal, Cancel, saving state and
error/success feedback. Images use the existing same-origin main/tenant asset
proxies. A fallback initials avatar remains available when there is no image.

## Deployment

The additive migration is
`prisma/migrations/20261031110000_add_user_avatar/migration.sql`. Apply migrations
before deploying the new session queries. It was applied successfully to the
configured local database during implementation. Regenerate the Prisma client and
each console's GraphQL client when deploying.

## Validation

- `tests/modules/users/profile.service.test.ts`: self-only writes, role/audience
  and tenant checks, unknown-field rejection, safe display projection, image
  replacement/removal, transaction failure cleanup and duplicate usernames.
- `tests/modules/users/profile.database.test.ts`: real save/reload/removal,
  normalized 256×256 WebP output, metadata removal, cross-tenant rejection and
  spoofed image rejection. Run against a migrated seeded test database with
  `RUN_PROFILE_DATABASE_TESTS=1`.

The 12 service tests and three database/GraphQL/image integration tests passed. No password
or email-change capability is included in this profile editor.
