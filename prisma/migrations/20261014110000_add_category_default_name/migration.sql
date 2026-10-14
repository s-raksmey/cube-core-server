ALTER TABLE "categories" ADD COLUMN "name" TEXT;

UPDATE "categories" AS category
SET "name" = translation."name"
FROM "category_translations" AS translation
WHERE translation."category_uuid" = category."uuid"
  AND translation."locale" = 'en';

UPDATE "categories"
SET "name" = "slug"
WHERE "name" IS NULL;

ALTER TABLE "categories" ALTER COLUMN "name" SET NOT NULL;
