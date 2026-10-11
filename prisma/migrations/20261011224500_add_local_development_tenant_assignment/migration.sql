CREATE TABLE "local_development_tenants" (
    "hostname" TEXT NOT NULL,
    "tenant_uuid" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "local_development_tenants_pkey" PRIMARY KEY ("hostname")
);

CREATE UNIQUE INDEX "local_development_tenants_tenant_uuid_key"
ON "local_development_tenants"("tenant_uuid");

ALTER TABLE "local_development_tenants"
ADD CONSTRAINT "local_development_tenants_tenant_uuid_fkey"
FOREIGN KEY ("tenant_uuid") REFERENCES "tenants"("uuid")
ON DELETE CASCADE ON UPDATE CASCADE;
