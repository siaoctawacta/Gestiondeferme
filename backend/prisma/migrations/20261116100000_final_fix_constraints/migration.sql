-- Final fix wave of slice 4: one index, the sale/return invariants of the stock ledger, and CHECKs that cannot pass on an unknown kind.
-- None of these statements touches a column the FinanceLedgerView reads (no drop/recreate of the view needed).

-- Reversals read the events of one source (a sale, a credit note, a breeding step).
CREATE INDEX "BatchEvent_sourceType_sourceId_idx" ON "BatchEvent"("sourceType", "sourceId");

-- Redundant with "FinanceEntry_farmId_date_idx" (same leading column).
DROP INDEX "FinanceEntry_farmId_idx";

-- A sale is an exit written by an invoice; a return is an entry written by a credit note.
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_sale_check" CHECK ("reason" <> 'VENTE' OR ("quantity" < 0 AND "sourceType" = 'SALE'));
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_return_check" CHECK ("reason" <> 'RETOUR' OR ("quantity" > 0 AND "sourceType" = 'CREDIT_NOTE'));

-- Only the sales module writes where an animal went.
ALTER TABLE "Animal" ADD CONSTRAINT "Animal_exitSourceType_check" CHECK ("exitSourceType" IS NULL OR "exitSourceType" IN ('SALE'));

-- An issued invoice always has its due date.
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_dueDate_issued_check" CHECK ("status" = 'BROUILLON' OR "dueDate" IS NOT NULL);

-- The CASE checks: an unknown kind is refused (a CASE with no match is NULL, which a CHECK lets through).
ALTER TABLE "QuoteLine" DROP CONSTRAINT "QuoteLine_kind_check";
ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_kind_check" CHECK (
  CASE "kind"
    WHEN 'LOT' THEN "batchId" IS NOT NULL AND "animalId" IS NULL AND "stockItemId" IS NULL AND "eggsPerUnit" IS NULL AND "quantity" = TRUNC("quantity")
    WHEN 'ANIMAL' THEN "animalId" IS NOT NULL AND "batchId" IS NULL AND "stockItemId" IS NULL AND "eggsPerUnit" IS NULL AND "quantity" = 1
    WHEN 'OEUFS' THEN "batchId" IS NOT NULL AND "eggsPerUnit" IS NOT NULL AND "eggsPerUnit" > 0 AND "animalId" IS NULL AND "stockItemId" IS NULL AND "quantity" = TRUNC("quantity")
    WHEN 'ARTICLE' THEN "stockItemId" IS NOT NULL AND "batchId" IS NULL AND "animalId" IS NULL AND "eggsPerUnit" IS NULL
    WHEN 'SERVICE' THEN "batchId" IS NULL AND "animalId" IS NULL AND "stockItemId" IS NULL AND "eggsPerUnit" IS NULL
    ELSE false
  END
);
ALTER TABLE "InvoiceLine" DROP CONSTRAINT "InvoiceLine_kind_check";
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_kind_check" CHECK (
  CASE "kind"
    WHEN 'LOT' THEN "batchId" IS NOT NULL AND "animalId" IS NULL AND "stockItemId" IS NULL AND "eggsPerUnit" IS NULL AND "quantity" = TRUNC("quantity")
    WHEN 'ANIMAL' THEN "animalId" IS NOT NULL AND "batchId" IS NULL AND "stockItemId" IS NULL AND "eggsPerUnit" IS NULL AND "quantity" = 1
    WHEN 'OEUFS' THEN "batchId" IS NOT NULL AND "eggsPerUnit" IS NOT NULL AND "eggsPerUnit" > 0 AND "animalId" IS NULL AND "stockItemId" IS NULL AND "quantity" = TRUNC("quantity")
    WHEN 'ARTICLE' THEN "stockItemId" IS NOT NULL AND "batchId" IS NULL AND "animalId" IS NULL AND "eggsPerUnit" IS NULL
    WHEN 'SERVICE' THEN "batchId" IS NULL AND "animalId" IS NULL AND "stockItemId" IS NULL AND "eggsPerUnit" IS NULL
    ELSE false
  END
);
ALTER TABLE "InvoiceLine" DROP CONSTRAINT "InvoiceLine_category_check";
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_category_check" CHECK (
  CASE "kind"
    WHEN 'LOT' THEN "revenueCategory" = 'VENTE_ANIMAUX'::"FinanceCategory"
    WHEN 'ANIMAL' THEN "revenueCategory" = 'VENTE_ANIMAUX'::"FinanceCategory"
    WHEN 'OEUFS' THEN "revenueCategory" = 'VENTE_OEUFS'::"FinanceCategory"
    WHEN 'ARTICLE' THEN "revenueCategory" = 'VENTE_ARTICLES'::"FinanceCategory"
    WHEN 'SERVICE' THEN "revenueCategory" = 'PRESTATIONS'::"FinanceCategory"
    ELSE false
  END
);
ALTER TABLE "FinanceEntry" DROP CONSTRAINT "FinanceEntry_category_check";
ALTER TABLE "FinanceEntry" ADD CONSTRAINT "FinanceEntry_category_check" CHECK (
  CASE "kind"
    WHEN 'DEPENSE' THEN "category" IN ('ANIMAUX', 'ALIMENT', 'SANTE', 'MATERIEL', 'CONSOMMABLES', 'SALAIRES', 'ENERGIE', 'EAU', 'TRANSPORT', 'ENTRETIEN', 'AUTRE_CHARGE')
    WHEN 'RECETTE' THEN "category" IN ('VENTE_ANIMAUX', 'VENTE_OEUFS', 'VENTE_ARTICLES', 'PRESTATIONS', 'AUTRE_RECETTE')
    ELSE false
  END
);
