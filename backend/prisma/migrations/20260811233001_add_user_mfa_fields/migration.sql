-- AlterTable
ALTER TABLE "users" ADD COLUMN     "is_mfa_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "mfa_backup_codes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "totp_secret" TEXT;
