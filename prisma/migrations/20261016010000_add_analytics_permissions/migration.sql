INSERT INTO "role_permissions" ("uuid", "role_uuid", "permission")
SELECT gen_random_uuid(), "uuid", defaults.permission
FROM "roles"
JOIN (VALUES
  ('ADMIN', 'ANALYTICS_VIEW_TENANT'),
  ('EDITOR', 'ANALYTICS_VIEW_OWN')
) AS defaults(role_code, permission) ON "roles"."code" = defaults.role_code
ON CONFLICT ("role_uuid", "permission") DO NOTHING;
