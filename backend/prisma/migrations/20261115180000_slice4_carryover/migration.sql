-- Slice 4 carry-over: one document counter table, stored purchase amounts, activity and expense-category snapshot.

-- CreateEnum
CREATE TYPE "FinanceCategory" AS ENUM ('ANIMAUX', 'ALIMENT', 'SANTE', 'MATERIEL', 'CONSOMMABLES', 'SALAIRES', 'ENERGIE', 'EAU', 'TRANSPORT', 'ENTRETIEN', 'AUTRE_CHARGE', 'VENTE_ANIMAUX', 'VENTE_OEUFS', 'VENTE_ARTICLES', 'PRESTATIONS', 'AUTRE_RECETTE');

-- CreateEnum
CREATE TYPE "Activity" AS ENUM ('AVICOLE', 'PORCIN', 'GENERAL');

-- PurchaseCounter becomes DocumentCounter (same rows, same columns): rename the table and everything named after it.
ALTER TABLE "PurchaseCounter" RENAME TO "DocumentCounter";
ALTER TABLE "DocumentCounter" RENAME CONSTRAINT "PurchaseCounter_pkey" TO "DocumentCounter_pkey";
ALTER TABLE "DocumentCounter" RENAME CONSTRAINT "PurchaseCounter_organizationId_fkey" TO "DocumentCounter_organizationId_fkey";
ALTER TABLE "DocumentCounter" RENAME CONSTRAINT "PurchaseCounter_last_check" TO "DocumentCounter_last_check";
ALTER TABLE "DocumentCounter" DROP CONSTRAINT "PurchaseCounter_kind_check";
ALTER TABLE "DocumentCounter" ADD CONSTRAINT "DocumentCounter_kind_check" CHECK ("kind" IN ('DA', 'BC', 'DV', 'FA', 'AV', 'RC'));

-- AlterTable
ALTER TABLE "Purchase" ADD COLUMN "activity" "Activity" NOT NULL DEFAULT 'GENERAL',
ADD COLUMN "amount" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- AlterTable (amount is filled below, then made NOT NULL)
ALTER TABLE "PurchaseItem" ADD COLUMN "amount" DECIMAL(14,2),
ADD COLUMN "expenseCategory" "FinanceCategory";

-- Backfill: a line is worth its received quantity (else its ordered one) × unit price, rounded to the cent.
UPDATE "PurchaseItem" SET "amount" = ROUND(COALESCE("receivedQuantity", "quantity") * "unitPrice", 2);

-- Backfill: a purchase is worth the sum of its lines.
UPDATE "Purchase" p SET "amount" = COALESCE(
  (SELECT SUM(i."amount") FROM "PurchaseItem" i WHERE i."purchaseId" = p."id"), 0);

-- Backfill: a line received above 0 takes the article's current category (the best that is known for past receptions).
UPDATE "PurchaseItem" i SET "expenseCategory" = (
  CASE s."category"
    WHEN 'ALIMENT' THEN 'ALIMENT'
    WHEN 'MEDICAMENT' THEN 'SANTE'
    WHEN 'VACCIN' THEN 'SANTE'
    WHEN 'MATERIEL' THEN 'MATERIEL'
    ELSE 'CONSOMMABLES'
  END)::"FinanceCategory"
FROM "StockItem" s
WHERE s."id" = i."stockItemId" AND i."receivedQuantity" > 0;

ALTER TABLE "PurchaseItem" ALTER COLUMN "amount" SET NOT NULL;

-- Stored amounts are written by the service only; the database refuses what contradicts the line.
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_amount_check" CHECK ("amount" >= 0);
ALTER TABLE "PurchaseItem" ADD CONSTRAINT "PurchaseItem_amount_check" CHECK ("amount" = ROUND(COALESCE("receivedQuantity", "quantity") * "unitPrice", 2));
-- A line received above 0 carries its category; a line not received, or received at 0, carries none.
ALTER TABLE "PurchaseItem" ADD CONSTRAINT "PurchaseItem_expenseCategory_check" CHECK (("expenseCategory" IS NULL) = (COALESCE("receivedQuantity", 0) = 0));
