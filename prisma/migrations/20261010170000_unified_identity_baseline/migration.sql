-- Baseline: unified identity schema (replaces MainUser/SubUser migration history).

CREATE SCHEMA IF NOT EXISTS "public";

CREATE TYPE "TenantType" AS ENUM ('MAIN', 'SUB');
CREATE TYPE "TenantStatus" AS ENUM ('ACTIVE', 'SUSPENDED');
CREATE TYPE "UserStatus" AS ENUM ('PENDING', 'ACTIVE', 'DISABLED');
CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'DISABLED');
CREATE TYPE "AuthAudience" AS ENUM ('ADMIN_CONSOLE', 'TENANT_APP');
CREATE TYPE "AuthChallengeType" AS ENUM ('TOTP_ENROLL', 'TOTP_VERIFY', 'RECOVERY');

CREATE TABLE "tenants" (
    "uuid" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "type" "TenantType" NOT NULL,
    "parent_tenant_uuid" TEXT,
    "status" "TenantStatus" NOT NULL DEFAULT 'ACTIVE',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "tenants_pkey" PRIMARY KEY ("uuid")
);

CREATE TABLE "roles" (
    "uuid" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "roles_pkey" PRIMARY KEY ("uuid")
);

CREATE TABLE "users" (
    "uuid" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "username" TEXT,
    "email" TEXT NOT NULL,
    "password_hash" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'PENDING',
    "created_by" TEXT,
    "activated_at" TIMESTAMP(3),
    "last_login_at" TIMESTAMP(3),
    "sessions_revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "users_pkey" PRIMARY KEY ("uuid")
);

CREATE TABLE "tenant_memberships" (
    "uuid" TEXT NOT NULL,
    "user_uuid" TEXT NOT NULL,
    "tenant_uuid" TEXT NOT NULL,
    "role_uuid" TEXT NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "tenant_memberships_pkey" PRIMARY KEY ("uuid")
);

CREATE TABLE "user_activation_tokens" (
    "uuid" TEXT NOT NULL,
    "user_uuid" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_activation_tokens_pkey" PRIMARY KEY ("uuid")
);

CREATE TABLE "user_password_reset_tokens" (
    "uuid" TEXT NOT NULL,
    "user_uuid" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_password_reset_tokens_pkey" PRIMARY KEY ("uuid")
);

CREATE TABLE "user_two_factor_auth" (
    "uuid" TEXT NOT NULL,
    "user_uuid" TEXT NOT NULL,
    "encrypted_secret" TEXT,
    "pending_encrypted_secret" TEXT,
    "pending_expires_at" TIMESTAMP(3),
    "enabled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "user_two_factor_auth_pkey" PRIMARY KEY ("uuid")
);

CREATE TABLE "user_recovery_codes" (
    "uuid" TEXT NOT NULL,
    "user_uuid" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_recovery_codes_pkey" PRIMARY KEY ("uuid")
);

CREATE TABLE "user_sessions" (
    "uuid" TEXT NOT NULL,
    "user_uuid" TEXT NOT NULL,
    "tenant_uuid" TEXT NOT NULL,
    "audience" "AuthAudience" NOT NULL,
    "refresh_token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(3),
    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("uuid")
);

CREATE TABLE "auth_login_challenges" (
    "uuid" TEXT NOT NULL,
    "user_uuid" TEXT NOT NULL,
    "tenant_uuid" TEXT NOT NULL,
    "audience" "AuthAudience" NOT NULL,
    "type" "AuthChallengeType" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "auth_login_challenges_pkey" PRIMARY KEY ("uuid")
);

CREATE TABLE "auth_totp_replay_guards" (
    "uuid" TEXT NOT NULL,
    "user_uuid" TEXT NOT NULL,
    "time_step" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "auth_totp_replay_guards_pkey" PRIMARY KEY ("uuid")
);

CREATE TABLE "audit_logs" (
    "uuid" TEXT NOT NULL,
    "actor_user_uuid" TEXT,
    "tenant_uuid" TEXT,
    "action" TEXT NOT NULL,
    "target_type" TEXT,
    "target_uuid" TEXT,
    "request_id" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("uuid")
);

CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");
CREATE INDEX "tenants_parent_tenant_uuid_idx" ON "tenants"("parent_tenant_uuid");
CREATE INDEX "tenants_type_status_idx" ON "tenants"("type", "status");
CREATE UNIQUE INDEX "tenants_one_main_key" ON "tenants"("type") WHERE "type" = 'MAIN';

CREATE UNIQUE INDEX "roles_code_key" ON "roles"("code");

CREATE UNIQUE INDEX "users_username_key" ON "users"("username");
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE INDEX "users_status_idx" ON "users"("status");

CREATE INDEX "tenant_memberships_tenant_uuid_idx" ON "tenant_memberships"("tenant_uuid");
CREATE INDEX "tenant_memberships_role_uuid_idx" ON "tenant_memberships"("role_uuid");
CREATE UNIQUE INDEX "tenant_memberships_user_uuid_tenant_uuid_key" ON "tenant_memberships"("user_uuid", "tenant_uuid");

CREATE UNIQUE INDEX "user_activation_tokens_token_hash_key" ON "user_activation_tokens"("token_hash");
CREATE INDEX "user_activation_tokens_user_uuid_idx" ON "user_activation_tokens"("user_uuid");
CREATE INDEX "user_activation_tokens_expires_at_idx" ON "user_activation_tokens"("expires_at");

CREATE UNIQUE INDEX "user_password_reset_tokens_token_hash_key" ON "user_password_reset_tokens"("token_hash");
CREATE INDEX "user_password_reset_tokens_user_uuid_idx" ON "user_password_reset_tokens"("user_uuid");
CREATE INDEX "user_password_reset_tokens_expires_at_idx" ON "user_password_reset_tokens"("expires_at");

CREATE UNIQUE INDEX "user_two_factor_auth_user_uuid_key" ON "user_two_factor_auth"("user_uuid");

CREATE INDEX "user_recovery_codes_user_uuid_idx" ON "user_recovery_codes"("user_uuid");

CREATE UNIQUE INDEX "user_sessions_refresh_token_hash_key" ON "user_sessions"("refresh_token_hash");
CREATE INDEX "user_sessions_user_uuid_idx" ON "user_sessions"("user_uuid");
CREATE INDEX "user_sessions_tenant_uuid_idx" ON "user_sessions"("tenant_uuid");
CREATE INDEX "user_sessions_expires_at_idx" ON "user_sessions"("expires_at");

CREATE UNIQUE INDEX "auth_login_challenges_token_hash_key" ON "auth_login_challenges"("token_hash");
CREATE INDEX "auth_login_challenges_user_uuid_idx" ON "auth_login_challenges"("user_uuid");
CREATE INDEX "auth_login_challenges_expires_at_idx" ON "auth_login_challenges"("expires_at");

CREATE UNIQUE INDEX "auth_totp_replay_guards_user_uuid_time_step_key" ON "auth_totp_replay_guards"("user_uuid", "time_step");

CREATE INDEX "audit_logs_actor_user_uuid_idx" ON "audit_logs"("actor_user_uuid");
CREATE INDEX "audit_logs_tenant_uuid_idx" ON "audit_logs"("tenant_uuid");
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

ALTER TABLE "tenants" ADD CONSTRAINT "tenants_parent_tenant_uuid_fkey" FOREIGN KEY ("parent_tenant_uuid") REFERENCES "tenants"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "users" ADD CONSTRAINT "users_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "tenant_memberships" ADD CONSTRAINT "tenant_memberships_user_uuid_fkey" FOREIGN KEY ("user_uuid") REFERENCES "users"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tenant_memberships" ADD CONSTRAINT "tenant_memberships_tenant_uuid_fkey" FOREIGN KEY ("tenant_uuid") REFERENCES "tenants"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tenant_memberships" ADD CONSTRAINT "tenant_memberships_role_uuid_fkey" FOREIGN KEY ("role_uuid") REFERENCES "roles"("uuid") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tenant_memberships" ADD CONSTRAINT "tenant_memberships_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "user_activation_tokens" ADD CONSTRAINT "user_activation_tokens_user_uuid_fkey" FOREIGN KEY ("user_uuid") REFERENCES "users"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_activation_tokens" ADD CONSTRAINT "user_activation_tokens_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("uuid") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "user_password_reset_tokens" ADD CONSTRAINT "user_password_reset_tokens_user_uuid_fkey" FOREIGN KEY ("user_uuid") REFERENCES "users"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_password_reset_tokens" ADD CONSTRAINT "user_password_reset_tokens_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("uuid") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "user_two_factor_auth" ADD CONSTRAINT "user_two_factor_auth_user_uuid_fkey" FOREIGN KEY ("user_uuid") REFERENCES "users"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_recovery_codes" ADD CONSTRAINT "user_recovery_codes_user_uuid_fkey" FOREIGN KEY ("user_uuid") REFERENCES "users"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_uuid_fkey" FOREIGN KEY ("user_uuid") REFERENCES "users"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_tenant_uuid_fkey" FOREIGN KEY ("tenant_uuid") REFERENCES "tenants"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "auth_login_challenges" ADD CONSTRAINT "auth_login_challenges_user_uuid_fkey" FOREIGN KEY ("user_uuid") REFERENCES "users"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "auth_login_challenges" ADD CONSTRAINT "auth_login_challenges_tenant_uuid_fkey" FOREIGN KEY ("tenant_uuid") REFERENCES "tenants"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "auth_totp_replay_guards" ADD CONSTRAINT "auth_totp_replay_guards_user_uuid_fkey" FOREIGN KEY ("user_uuid") REFERENCES "users"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_uuid_fkey" FOREIGN KEY ("actor_user_uuid") REFERENCES "users"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenant_uuid_fkey" FOREIGN KEY ("tenant_uuid") REFERENCES "tenants"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- Singleton MAIN tenant (never created by seed)
INSERT INTO "tenants" (
  "uuid", "name", "slug", "type", "parent_tenant_uuid", "status", "settings", "created_at", "updated_at"
)
SELECT
  '00000000-0000-4000-8000-000000000100',
  'Core Super Admin',
  'core-super-admin',
  'MAIN',
  NULL,
  'ACTIVE',
  '{}',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "tenants" WHERE "type" = 'MAIN');
