-- Enforce the normalized uniqueness and Main-tenant invariants already used by services.
-- This migration intentionally fails with a clear message if existing data needs cleanup.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM users GROUP BY lower(email) HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate case-insensitive user emails exist; clean them before applying auth identity constraints';
  END IF;
  IF EXISTS (
    SELECT 1 FROM users WHERE username IS NOT NULL
    GROUP BY lower(username) HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate case-insensitive usernames exist; clean them before applying auth identity constraints';
  END IF;
  IF (SELECT count(*) FROM tenants WHERE type = 'MAIN') > 1 THEN
    RAISE EXCEPTION 'More than one MAIN tenant exists; reconcile it before applying auth identity constraints';
  END IF;
END $$;

CREATE UNIQUE INDEX users_email_lower_key ON users (lower(email));
CREATE UNIQUE INDEX users_username_lower_key ON users (lower(username)) WHERE username IS NOT NULL;
CREATE UNIQUE INDEX tenants_single_main_key ON tenants (type) WHERE type = 'MAIN';