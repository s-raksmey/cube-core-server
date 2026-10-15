-- Add the dedicated capability to built-in roles without replacing custom grants.
INSERT INTO "role_permissions" ("uuid", "role_uuid", "permission")
SELECT gen_random_uuid(), r."uuid", 'ARTICLE_REQUEST_CHANGES'
FROM "roles" r
WHERE r."code" IN ('ADMIN', 'EDITOR')
ON CONFLICT ("role_uuid", "permission") DO NOTHING;
