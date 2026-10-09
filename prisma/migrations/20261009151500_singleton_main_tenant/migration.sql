-- Enforce exactly one MAIN tenant at the database level.
CREATE UNIQUE INDEX IF NOT EXISTS "Tenant_one_main_key"
ON "Tenant" (type)
WHERE type = 'MAIN';

-- Rename legacy seeded slug if it exists.
UPDATE "Tenant"
SET
  slug = 'core-super-admin',
  name = 'Core Super Admin',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE type = 'MAIN'
  AND slug = 'core-admin';

-- Create the singleton MAIN tenant once (never created by seed).
INSERT INTO "Tenant" (
  id,
  type,
  "parentTenantId",
  name,
  slug,
  status,
  settings,
  "createdAt",
  "updatedAt"
)
SELECT
  gen_random_uuid(),
  'MAIN',
  NULL,
  'Core Super Admin',
  'core-super-admin',
  'ACTIVE',
  '{}'::jsonb,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
WHERE NOT EXISTS (
  SELECT 1 FROM "Tenant" WHERE type = 'MAIN'
);
