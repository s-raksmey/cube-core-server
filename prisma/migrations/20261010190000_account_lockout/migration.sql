ALTER TYPE "UserStatus" ADD VALUE 'LOCKED';

ALTER TABLE "users"
  ADD COLUMN "failed_password_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "failed_totp_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "locked_until" TIMESTAMP(3);
