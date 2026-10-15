-- Extend the built-in Editor defaults without replacing existing role grants.
INSERT INTO "role_permissions" ("uuid", "role_uuid", "permission")
SELECT gen_random_uuid(), r."uuid", p.permission
FROM "roles" r CROSS JOIN (VALUES
  ('ARTICLE_SET_BREAKING'), ('ARTICLE_SET_FEATURED')
) AS p(permission)
WHERE r."code" = 'EDITOR'
ON CONFLICT ("role_uuid", "permission") DO NOTHING;
