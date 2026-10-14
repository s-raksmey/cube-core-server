CREATE TABLE "articles" (
  "uuid" TEXT NOT NULL,
  "tenant_uuid" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "articles_pkey" PRIMARY KEY ("uuid")
);
CREATE UNIQUE INDEX "articles_uuid_tenant_uuid_key" ON "articles"("uuid", "tenant_uuid");
CREATE INDEX "articles_tenant_uuid_idx" ON "articles"("tenant_uuid");
CREATE UNIQUE INDEX "tags_uuid_tenant_uuid_key" ON "tags"("uuid", "tenant_uuid");
ALTER TABLE "articles" ADD CONSTRAINT "articles_tenant_uuid_fkey" FOREIGN KEY ("tenant_uuid") REFERENCES "tenants"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE TABLE "article_tags" (
  "article_uuid" TEXT NOT NULL,
  "tag_uuid" TEXT NOT NULL,
  "tenant_uuid" TEXT NOT NULL,
  CONSTRAINT "article_tags_pkey" PRIMARY KEY ("article_uuid", "tag_uuid")
);
CREATE INDEX "article_tags_tag_uuid_tenant_uuid_idx" ON "article_tags"("tag_uuid", "tenant_uuid");
ALTER TABLE "article_tags" ADD CONSTRAINT "article_tags_article_uuid_tenant_uuid_fkey" FOREIGN KEY ("article_uuid", "tenant_uuid") REFERENCES "articles"("uuid", "tenant_uuid") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "article_tags" ADD CONSTRAINT "article_tags_tag_uuid_tenant_uuid_fkey" FOREIGN KEY ("tag_uuid", "tenant_uuid") REFERENCES "tags"("uuid", "tenant_uuid") ON DELETE CASCADE ON UPDATE CASCADE;
