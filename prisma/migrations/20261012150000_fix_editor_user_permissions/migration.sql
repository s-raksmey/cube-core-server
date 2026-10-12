-- Editor user-management permissions are a fixed least-privilege policy.
DELETE FROM role_permissions
WHERE role_uuid IN (SELECT uuid FROM roles WHERE code = 'EDITOR');

INSERT INTO role_permissions (uuid, role_uuid, permission)
SELECT gen_random_uuid(), editor.uuid, allowed.permission
FROM roles AS editor
CROSS JOIN (VALUES ('USERS_VIEW'), ('USERS_EDIT')) AS allowed(permission)
WHERE editor.code = 'EDITOR'
ON CONFLICT (role_uuid, permission) DO NOTHING;
