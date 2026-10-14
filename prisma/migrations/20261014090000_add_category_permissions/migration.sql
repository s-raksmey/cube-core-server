-- Give platform and tenant administrators the complete category permission set.
INSERT INTO "role_permissions" ("uuid", "role_uuid", "permission")
SELECT gen_random_uuid(), "uuid", permission
FROM "roles" CROSS JOIN (
  VALUES
    ('CATEGORY_VIEW'),
    ('CATEGORY_VIEW_SUBCATEGORY'),
    ('CATEGORY_CREATE'),
    ('CATEGORY_CREATE_SUBCATEGORY'),
    ('CATEGORY_EDIT'),
    ('CATEGORY_EDIT_SUBCATEGORY'),
    ('CATEGORY_DELETE'),
    ('CATEGORY_DELETE_SUBCATEGORY')
) AS defaults(permission)
WHERE "code" IN ('SUPERADMIN', 'ADMIN')
ON CONFLICT ("role_uuid", "permission") DO NOTHING;

-- Editors may browse categories and sub categories, but cannot change them.
INSERT INTO "role_permissions" ("uuid", "role_uuid", "permission")
SELECT gen_random_uuid(), "uuid", permission
FROM "roles" CROSS JOIN (VALUES ('CATEGORY_VIEW'), ('CATEGORY_VIEW_SUBCATEGORY')) AS defaults(permission)
WHERE "code" = 'EDITOR'
ON CONFLICT ("role_uuid", "permission") DO NOTHING;

DELETE FROM "role_permissions"
WHERE "role_uuid" IN (SELECT "uuid" FROM "roles" WHERE "code" = 'EDITOR')
  AND "permission" IN (
    'CATEGORY_CREATE',
    'CATEGORY_CREATE_SUBCATEGORY',
    'CATEGORY_EDIT',
    'CATEGORY_EDIT_SUBCATEGORY',
    'CATEGORY_DELETE',
    'CATEGORY_DELETE_SUBCATEGORY'
  );
