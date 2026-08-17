-- CreateEnum
CREATE TYPE "GraClearanceStatus" AS ENUM ('NOT_REQUESTED', 'PENDING', 'CLEARED', 'FAILED');

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "gra_clearance_error" TEXT,
ADD COLUMN     "gra_clearance_status" "GraClearanceStatus" NOT NULL DEFAULT 'NOT_REQUESTED',
ADD COLUMN     "gra_cleared_at" TIMESTAMP(3),
ADD COLUMN     "gra_encrypted_data" TEXT,
ADD COLUMN     "gra_qr_code_data" TEXT,
ADD COLUMN     "gra_signature" TEXT,
ADD COLUMN     "gra_verification_engine_id" TEXT;
