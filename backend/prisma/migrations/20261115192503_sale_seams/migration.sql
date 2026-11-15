-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "StockReason" ADD VALUE 'VENTE';
ALTER TYPE "StockReason" ADD VALUE 'RETOUR';

-- AlterTable
ALTER TABLE "Animal" ADD COLUMN     "exitSourceId" TEXT,
ADD COLUMN     "exitSourceLabel" TEXT,
ADD COLUMN     "exitSourceType" TEXT;

-- CreateIndex
CREATE INDEX "Animal_exitSourceType_exitSourceId_idx" ON "Animal"("exitSourceType", "exitSourceId");

-- An animal sold by a document carries where it went (all three or none), and only when it left as sold.
ALTER TABLE "Animal" ADD CONSTRAINT "Animal_exitSource_check" CHECK (
  ("exitSourceType" IS NULL AND "exitSourceId" IS NULL AND "exitSourceLabel" IS NULL)
  OR ("exitSourceType" IS NOT NULL AND "exitSourceId" IS NOT NULL AND "exitSourceLabel" IS NOT NULL
      AND "exitReason" IS NOT NULL AND "exitReason" = 'VENDU')
);
