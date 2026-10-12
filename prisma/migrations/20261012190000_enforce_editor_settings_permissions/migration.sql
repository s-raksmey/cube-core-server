-- Keep the final defaults explicit even when an older applied branding migration
-- did not seed every role permission.
INSERT INTO "role_permissions" ("uuid", "role_uuid", "permission")
SELECT gen_random_uuid(), "uuid", permission
FROM "roles" CROSS JOIN (VALUES ('BRANDING_VIEW'), ('BRANDING_UPDATE')) AS defaults(permission)
WHERE "code" IN ('SUPERADMIN', 'ADMIN')
ON CONFLICT ("role_uuid", "permission") DO NOTHING;

-- Editors can see the settings page, but only tenant Admins may change branding.
INSERT INTO "role_permissions" ("uuid", "role_uuid", "permission")
SELECT gen_random_uuid(), "uuid", 'BRANDING_VIEW'
FROM "roles"
WHERE "code" = 'EDITOR'
ON CONFLICT ("role_uuid", "permission") DO NOTHING;

DELETE FROM "role_permissions"
WHERE "permission" = 'BRANDING_UPDATE'
  AND "role_uuid" IN (SELECT "uuid" FROM "roles" WHERE "code" = 'EDITOR');
