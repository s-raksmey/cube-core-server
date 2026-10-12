INSERT INTO "role_permissions" ("uuid", "role_uuid", "permission")
SELECT gen_random_uuid(), "uuid", permission
FROM "roles"
CROSS JOIN (VALUES
  ('USERS_VIEW'),
  ('USERS_CREATE'),
  ('USERS_EDIT'),
  ('USERS_ACTIVATE'),
  ('USERS_SUSPEND'),
  ('USERS_RESET_PASSWORD')
) AS defaults(permission)
WHERE "code" = 'SUPERADMIN'
ON CONFLICT ("role_uuid", "permission") DO NOTHING;
