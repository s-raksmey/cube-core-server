-- Grant the new permission to the existing built-in Admin role without
-- changing any other permission choices. Editor remains ungranted by default.
INSERT INTO "role_permissions" ("uuid", "role_uuid", "permission")
SELECT gen_random_uuid(), r."uuid", 'ARTICLE_DELETE_ARCHIVED'
FROM "roles" r
WHERE r."code" = 'ADMIN'
ON CONFLICT ("role_uuid", "permission") DO NOTHING;
