-- The earlier Article model was a relational foundation with no CRUD. Existing
-- rows cannot be assigned a trustworthy category/subcategory automatically.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "articles" LIMIT 1) THEN
    RAISE EXCEPTION 'Resolve existing placeholder articles before applying the editorial workflow migration';
  END IF;
END $$;

CREATE TYPE "ArticleStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'SCHEDULED', 'PUBLISHED', 'ARCHIVED');
CREATE TYPE "ArticleReviewDecision" AS ENUM ('SUBMITTED', 'CHANGES_REQUESTED', 'APPROVED');

DROP INDEX "articles_tenant_uuid_idx";
ALTER TABLE "articles"
  ADD COLUMN "archived_at" TIMESTAMP(3),
  ADD COLUMN "category_uuid" TEXT NOT NULL,
  ADD COLUMN "content" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "created_by_uuid" TEXT,
  ADD COLUMN "featured_image_url" TEXT,
  ADD COLUMN "is_breaking" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "is_featured" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "published_at" TIMESTAMP(3),
  ADD COLUMN "published_by_uuid" TEXT,
  ADD COLUMN "scheduled_at" TIMESTAMP(3),
  ADD COLUMN "scheduled_by_uuid" TEXT,
  ADD COLUMN "slug" TEXT NOT NULL,
  ADD COLUMN "status" "ArticleStatus" NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN "subcategory_uuid" TEXT NOT NULL,
  ADD COLUMN "summary" TEXT;

CREATE TABLE "article_translations" (
  "uuid" TEXT NOT NULL,
  "article_uuid" TEXT NOT NULL,
  "locale" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "summary" TEXT,
  "content" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "article_translations_pkey" PRIMARY KEY ("uuid")
);
CREATE TABLE "article_reviews" (
  "uuid" TEXT NOT NULL,
  "tenant_uuid" TEXT NOT NULL,
  "article_uuid" TEXT NOT NULL,
  "reviewer_uuid" TEXT,
  "decision" "ArticleReviewDecision" NOT NULL,
  "comment" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "article_reviews_pkey" PRIMARY KEY ("uuid")
);

CREATE INDEX "article_translations_locale_idx" ON "article_translations"("locale");
CREATE UNIQUE INDEX "article_translations_article_uuid_locale_key" ON "article_translations"("article_uuid", "locale");
CREATE INDEX "article_reviews_tenant_uuid_article_uuid_created_at_idx" ON "article_reviews"("tenant_uuid", "article_uuid", "created_at");
CREATE INDEX "articles_tenant_uuid_status_updated_at_idx" ON "articles"("tenant_uuid", "status", "updated_at");
CREATE INDEX "articles_status_scheduled_at_idx" ON "articles"("status", "scheduled_at");
CREATE INDEX "articles_tenant_uuid_created_by_uuid_idx" ON "articles"("tenant_uuid", "created_by_uuid");
CREATE UNIQUE INDEX "articles_tenant_uuid_slug_key" ON "articles"("tenant_uuid", "slug");
CREATE UNIQUE INDEX "categories_uuid_tenant_uuid_key" ON "categories"("uuid", "tenant_uuid");
CREATE UNIQUE INDEX "subcategories_uuid_tenant_uuid_category_uuid_key" ON "subcategories"("uuid", "tenant_uuid", "category_uuid");

ALTER TABLE "articles" ADD CONSTRAINT "articles_created_by_uuid_fkey" FOREIGN KEY ("created_by_uuid") REFERENCES "users"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "articles" ADD CONSTRAINT "articles_published_by_uuid_fkey" FOREIGN KEY ("published_by_uuid") REFERENCES "users"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "articles" ADD CONSTRAINT "articles_scheduled_by_uuid_fkey" FOREIGN KEY ("scheduled_by_uuid") REFERENCES "users"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "articles" ADD CONSTRAINT "articles_category_uuid_tenant_uuid_fkey" FOREIGN KEY ("category_uuid", "tenant_uuid") REFERENCES "categories"("uuid", "tenant_uuid") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "articles" ADD CONSTRAINT "articles_subcategory_uuid_tenant_uuid_category_uuid_fkey" FOREIGN KEY ("subcategory_uuid", "tenant_uuid", "category_uuid") REFERENCES "subcategories"("uuid", "tenant_uuid", "category_uuid") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "article_translations" ADD CONSTRAINT "article_translations_article_uuid_fkey" FOREIGN KEY ("article_uuid") REFERENCES "articles"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "article_reviews" ADD CONSTRAINT "article_reviews_article_uuid_tenant_uuid_fkey" FOREIGN KEY ("article_uuid", "tenant_uuid") REFERENCES "articles"("uuid", "tenant_uuid") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "article_reviews" ADD CONSTRAINT "article_reviews_reviewer_uuid_fkey" FOREIGN KEY ("reviewer_uuid") REFERENCES "users"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- Permissions are global to the built-in role codes. These codes are new, so
-- inserting defaults does not overwrite any pre-existing customized choices.
INSERT INTO "role_permissions" ("uuid", "role_uuid", "permission")
SELECT gen_random_uuid(), r."uuid", p.permission
FROM "roles" r CROSS JOIN (VALUES
  ('ARTICLE_VIEW'), ('ARTICLE_CREATE'), ('ARTICLE_UPDATE_OWN'), ('ARTICLE_UPDATE_ANY'),
  ('ARTICLE_DELETE_OWN'), ('ARTICLE_DELETE_ANY'), ('ARTICLE_SUBMIT'), ('ARTICLE_REVIEW'),
  ('ARTICLE_PUBLISH'), ('ARTICLE_SCHEDULE'), ('ARTICLE_ARCHIVE'), ('ARTICLE_RESTORE'),
  ('ARTICLE_SET_BREAKING'), ('ARTICLE_SET_FEATURED')
) AS p(permission)
WHERE r."code" = 'ADMIN'
ON CONFLICT ("role_uuid", "permission") DO NOTHING;
INSERT INTO "role_permissions" ("uuid", "role_uuid", "permission")
SELECT gen_random_uuid(), r."uuid", p.permission
FROM "roles" r CROSS JOIN (VALUES
  ('ARTICLE_VIEW'), ('ARTICLE_CREATE'), ('ARTICLE_UPDATE_OWN'),
  ('ARTICLE_DELETE_OWN'), ('ARTICLE_SUBMIT')
) AS p(permission)
WHERE r."code" = 'EDITOR'
ON CONFLICT ("role_uuid", "permission") DO NOTHING;
