/*
  Warnings:

  - You are about to drop the column `recorded_by_name` on the `invoice_payments` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "invoice_payments" DROP COLUMN "recorded_by_name",
ADD COLUMN     "recorded_by_email" TEXT;
