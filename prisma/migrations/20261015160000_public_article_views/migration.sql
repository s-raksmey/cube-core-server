ALTER TABLE "articles" ADD COLUMN "view_count" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "articles_tenant_uuid_status_published_at_idx"
  ON "articles"("tenant_uuid", "status", "published_at");

CREATE TABLE "article_views" (
  "uuid" TEXT NOT NULL,
  "tenant_uuid" TEXT NOT NULL,
  "article_uuid" TEXT NOT NULL,
  "visitor_key" TEXT NOT NULL,
  "bucket_start" TIMESTAMP(3) NOT NULL,
  "viewed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "article_views_pkey" PRIMARY KEY ("uuid")
);

CREATE UNIQUE INDEX "article_views_article_uuid_visitor_key_bucket_start_key"
  ON "article_views"("article_uuid", "visitor_key", "bucket_start");
CREATE INDEX "article_views_article_uuid_viewed_at_idx"
  ON "article_views"("article_uuid", "viewed_at");
CREATE INDEX "article_views_tenant_uuid_viewed_at_idx"
  ON "article_views"("tenant_uuid", "viewed_at");

ALTER TABLE "article_views" ADD CONSTRAINT "article_views_tenant_uuid_fkey"
  FOREIGN KEY ("tenant_uuid") REFERENCES "tenants"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "article_views" ADD CONSTRAINT "article_views_article_uuid_tenant_uuid_fkey"
  FOREIGN KEY ("article_uuid", "tenant_uuid") REFERENCES "articles"("uuid", "tenant_uuid") ON DELETE CASCADE ON UPDATE CASCADE;
