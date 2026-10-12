CREATE TABLE "tenant_branding" (
  "tenant_uuid" TEXT NOT NULL,
  "management_logo_path" TEXT,
  "website_logo_path" TEXT,
  "favicon_path" TEXT,
  "open_graph_image_path" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tenant_branding_pkey" PRIMARY KEY ("tenant_uuid"),
  CONSTRAINT "tenant_branding_tenant_uuid_fkey" FOREIGN KEY ("tenant_uuid") REFERENCES "tenants"("uuid") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "role_permissions" ("uuid", "role_uuid", "permission")
SELECT gen_random_uuid(), "uuid", permission
FROM "roles" CROSS JOIN (VALUES ('BRANDING_VIEW'), ('BRANDING_UPDATE')) AS defaults(permission)
WHERE "code" IN ('SUPERADMIN', 'ADMIN')
ON CONFLICT ("role_uuid", "permission") DO NOTHING;
