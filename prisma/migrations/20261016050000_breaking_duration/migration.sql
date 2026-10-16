ALTER TABLE "articles" ADD COLUMN "breaking_expires_at" TIMESTAMP(3);

-- Give existing published Breaking stories the new 24-hour default window.
UPDATE "articles"
SET "breaking_expires_at" = "published_at" + INTERVAL '24 hours'
WHERE "status" = 'PUBLISHED' AND "is_breaking" = true AND "published_at" IS NOT NULL;

CREATE INDEX "articles_tenant_uuid_status_is_breaking_breaking_expires_at_idx"
ON "articles"("tenant_uuid", "status", "is_breaking", "breaking_expires_at");
