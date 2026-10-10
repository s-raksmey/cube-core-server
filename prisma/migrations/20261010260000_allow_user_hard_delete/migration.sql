-- Token creator attribution is historical metadata. Removing a creator should not
-- prevent deleting that account or invalidate a token belonging to another user.
ALTER TABLE "user_activation_tokens"
  ALTER COLUMN "created_by" DROP NOT NULL;

ALTER TABLE "user_activation_tokens"
  DROP CONSTRAINT "user_activation_tokens_created_by_fkey";

ALTER TABLE "user_activation_tokens"
  ADD CONSTRAINT "user_activation_tokens_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("uuid")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "user_password_reset_tokens"
  ALTER COLUMN "created_by" DROP NOT NULL;

ALTER TABLE "user_password_reset_tokens"
  DROP CONSTRAINT "user_password_reset_tokens_created_by_fkey";

ALTER TABLE "user_password_reset_tokens"
  ADD CONSTRAINT "user_password_reset_tokens_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("uuid")
  ON DELETE SET NULL ON UPDATE CASCADE;
