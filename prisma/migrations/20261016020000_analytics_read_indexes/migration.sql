CREATE INDEX "audit_logs_tenant_uuid_created_at_idx" ON "audit_logs"("tenant_uuid", "created_at");
CREATE INDEX "articles_tenant_uuid_created_by_uuid_published_at_idx" ON "articles"("tenant_uuid", "created_by_uuid", "published_at");
CREATE INDEX "article_reviews_tenant_uuid_created_at_idx" ON "article_reviews"("tenant_uuid", "created_at");
