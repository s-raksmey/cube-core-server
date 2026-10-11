CREATE TYPE "TenantDomainPurpose" AS ENUM ('MANAGEMENT', 'WEBSITE');

CREATE TABLE "tenant_domains" (
    "uuid" TEXT NOT NULL,
    "tenant_uuid" TEXT NOT NULL,
    "purpose" "TenantDomainPurpose" NOT NULL,
    "hostname" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "tenant_domains_pkey" PRIMARY KEY ("uuid"),
    CONSTRAINT "tenant_domains_active_hostname_check"
      CHECK (("is_active" AND "hostname" IS NOT NULL) OR (NOT "is_active" AND "hostname" IS NULL)),
    CONSTRAINT "tenant_domains_tenant_uuid_fkey"
      FOREIGN KEY ("tenant_uuid") REFERENCES "tenants"("uuid")
      ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "tenant_domains_tenant_uuid_purpose_key"
  ON "tenant_domains"("tenant_uuid", "purpose");

-- Cleared domains are stored as NULL, so this unique index protects every active mapping.
CREATE UNIQUE INDEX "tenant_domains_hostname_key" ON "tenant_domains"("hostname");
