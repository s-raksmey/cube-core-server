CREATE TABLE "role_permissions" (
    "uuid" TEXT NOT NULL,
    "role_uuid" TEXT NOT NULL,
    "permission" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("uuid")
);

CREATE UNIQUE INDEX "role_permissions_role_uuid_permission_key"
    ON "role_permissions"("role_uuid", "permission");
CREATE INDEX "role_permissions_permission_idx"
    ON "role_permissions"("permission");

ALTER TABLE "role_permissions"
    ADD CONSTRAINT "role_permissions_role_uuid_fkey"
    FOREIGN KEY ("role_uuid") REFERENCES "roles"("uuid")
    ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "role_permissions" ("uuid", "role_uuid", "permission")
SELECT gen_random_uuid(), "uuid", permission
FROM "roles"
CROSS JOIN (VALUES
  ('USERS_VIEW'),
  ('USERS_CREATE'),
  ('USERS_EDIT'),
  ('USERS_ACTIVATE'),
  ('USERS_SUSPEND'),
  ('USERS_RESET_PASSWORD')
) AS defaults(permission)
WHERE "code" = 'ADMIN'
ON CONFLICT ("role_uuid", "permission") DO NOTHING;
