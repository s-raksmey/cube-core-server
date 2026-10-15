CREATE TYPE "ArticleSharePlatform" AS ENUM ('FACEBOOK', 'TELEGRAM', 'COPY_LINK', 'NATIVE');

ALTER TABLE "articles" ADD COLUMN "share_count" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "article_shares" (
  "uuid" TEXT NOT NULL,
  "tenant_uuid" TEXT NOT NULL,
  "article_uuid" TEXT NOT NULL,
  "platform" "ArticleSharePlatform" NOT NULL,
  "visitor_key" TEXT NOT NULL,
  "bucket_start" TIMESTAMP(3) NOT NULL,
  "shared_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "article_shares_pkey" PRIMARY KEY ("uuid")
);

CREATE UNIQUE INDEX "article_shares_dedup_key"
  ON "article_shares"("article_uuid", "visitor_key", "platform", "bucket_start");
CREATE INDEX "article_shares_article_uuid_shared_at_idx"
  ON "article_shares"("article_uuid", "shared_at");
CREATE INDEX "article_shares_tenant_uuid_shared_at_idx"
  ON "article_shares"("tenant_uuid", "shared_at");

ALTER TABLE "article_shares" ADD CONSTRAINT "article_shares_tenant_uuid_fkey"
  FOREIGN KEY ("tenant_uuid") REFERENCES "tenants"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "article_shares" ADD CONSTRAINT "article_shares_article_uuid_tenant_uuid_fkey"
  FOREIGN KEY ("article_uuid", "tenant_uuid") REFERENCES "articles"("uuid", "tenant_uuid") ON DELETE CASCADE ON UPDATE CASCADE;
