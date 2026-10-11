CREATE TYPE "TenantDomainStatus" AS ENUM (
  'PENDING_VERIFICATION',
  'PENDING_DNS',
  'ACTIVE',
  'ERROR',
  'DISABLED'
);

ALTER TABLE "tenant_domains"
  DROP CONSTRAINT "tenant_domains_active_hostname_check",
  ADD COLUMN "status" "TenantDomainStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
  ADD COLUMN "verified_at" TIMESTAMP(3),
  ADD COLUMN "verification_token" TEXT;

-- Saved mappings have not yet passed domain-ownership verification.
-- Preserve disconnected rows as disabled mappings without a hostname.
UPDATE "tenant_domains"
SET "status" = CASE
  WHEN "is_active" AND "hostname" IS NOT NULL THEN 'PENDING_VERIFICATION'::"TenantDomainStatus"
  ELSE 'DISABLED'::"TenantDomainStatus"
END;

ALTER TABLE "tenant_domains"
  DROP COLUMN "is_active",
  ADD CONSTRAINT "tenant_domains_status_hostname_check"
    CHECK (("status" = 'DISABLED' AND "hostname" IS NULL) OR
           ("status" <> 'DISABLED' AND "hostname" IS NOT NULL)),
  ADD CONSTRAINT "tenant_domains_active_verified_check"
    CHECK ("status" <> 'ACTIVE' OR "verified_at" IS NOT NULL),
  ADD CONSTRAINT "tenant_domains_dns_verified_check"
    CHECK ("status" <> 'PENDING_DNS' OR "verified_at" IS NOT NULL);
