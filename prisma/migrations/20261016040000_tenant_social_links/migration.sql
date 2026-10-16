CREATE TYPE "SocialPlatform" AS ENUM ('FACEBOOK', 'TELEGRAM', 'YOUTUBE', 'TIKTOK', 'INSTAGRAM', 'X', 'LINKEDIN');

CREATE TABLE "tenant_social_links" (
  "uuid" TEXT NOT NULL,
  "tenant_uuid" TEXT NOT NULL,
  "platform" "SocialPlatform" NOT NULL,
  "url" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tenant_social_links_pkey" PRIMARY KEY ("uuid")
);

CREATE UNIQUE INDEX "tenant_social_links_tenant_uuid_platform_key" ON "tenant_social_links"("tenant_uuid", "platform");
CREATE INDEX "tenant_social_links_tenant_uuid_enabled_sort_order_idx" ON "tenant_social_links"("tenant_uuid", "enabled", "sort_order");
ALTER TABLE "tenant_social_links" ADD CONSTRAINT "tenant_social_links_tenant_uuid_fkey" FOREIGN KEY ("tenant_uuid") REFERENCES "tenants"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;
