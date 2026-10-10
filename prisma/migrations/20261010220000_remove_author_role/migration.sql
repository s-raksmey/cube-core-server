-- Revoke Author memberships without deleting users or audit history.
-- Disabled memberships retain their tenant link for auditability, but no
-- account can use the unsupported Author role after this migration.
DO $$
DECLARE
  editor_role_uuid text;
  author_role_uuid text;
BEGIN
  SELECT uuid INTO editor_role_uuid FROM roles WHERE code = 'EDITOR';
  SELECT uuid INTO author_role_uuid FROM roles WHERE code = 'AUTHOR';

  IF author_role_uuid IS NOT NULL THEN
    IF editor_role_uuid IS NULL THEN
      RAISE EXCEPTION 'Cannot remove AUTHOR role because EDITOR role is missing';
    END IF;

    -- A user whose only access was an Author membership must not remain
    -- active as an unassigned user. Keep the row for audit foreign keys.
    UPDATE users AS u
    SET status = 'DISABLED',
        deleted_at = COALESCE(u.deleted_at, NOW()),
        updated_at = NOW()
    WHERE u.deleted_at IS NULL
      AND EXISTS (
        SELECT 1
        FROM tenant_memberships AS author_membership
        WHERE author_membership.user_uuid = u.uuid
          AND author_membership.role_uuid = author_role_uuid
      )
      AND NOT EXISTS (
        SELECT 1
        FROM tenant_memberships AS active_membership
        JOIN roles AS active_role ON active_role.uuid = active_membership.role_uuid
        WHERE active_membership.user_uuid = u.uuid
          AND active_membership.status = 'ACTIVE'
          AND active_role.code <> 'AUTHOR'
      );

    UPDATE tenant_memberships
    SET role_uuid = editor_role_uuid,
        status = 'DISABLED'
    WHERE role_uuid = author_role_uuid;

    DELETE FROM roles WHERE uuid = author_role_uuid;
  END IF;
END $$;
