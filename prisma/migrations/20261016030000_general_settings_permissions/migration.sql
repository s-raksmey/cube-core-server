INSERT INTO "role_permissions" ("uuid", "role_uuid", "permission")
SELECT gen_random_uuid(), roles."uuid", defaults.permission
FROM "roles"
JOIN (VALUES
  ('ADMIN', 'SETTINGS_VIEW'),
  ('ADMIN', 'SETTINGS_UPDATE'),
  ('EDITOR', 'SETTINGS_VIEW')
) AS defaults(role_code, permission) ON roles."code" = defaults.role_code
ON CONFLICT ("role_uuid", "permission") DO NOTHING;
