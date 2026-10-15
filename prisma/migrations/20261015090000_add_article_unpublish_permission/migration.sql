-- The permission is new. Grant it to the existing built-in Admin role without
-- changing any other customizations or granting it to Editor by default.
INSERT INTO "role_permissions" ("uuid", "role_uuid", "permission")
SELECT gen_random_uuid(), r."uuid", 'ARTICLE_UNPUBLISH'
FROM "roles" r
WHERE r."code" = 'ADMIN'
ON CONFLICT ("role_uuid", "permission") DO NOTHING;
