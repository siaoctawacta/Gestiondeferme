-- CreateEnum
CREATE TYPE "FinanceKind" AS ENUM ('DEPENSE', 'RECETTE');

-- CreateTable
CREATE TABLE "FinanceEntry" (
    "id" TEXT NOT NULL,
    "farmId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "kind" "FinanceKind" NOT NULL,
    "label" TEXT NOT NULL,
    "activity" "Activity" NOT NULL,
    "category" "FinanceCategory" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "batchId" TEXT,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinanceEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FinanceEntry_farmId_idx" ON "FinanceEntry"("farmId");

-- CreateIndex
CREATE INDEX "FinanceEntry_farmId_date_idx" ON "FinanceEntry"("farmId", "date");

-- CreateIndex
CREATE INDEX "FinanceEntry_batchId_idx" ON "FinanceEntry"("batchId");

-- CreateIndex
CREATE INDEX "FinanceEntry_createdById_idx" ON "FinanceEntry"("createdById");

-- AddForeignKey
ALTER TABLE "FinanceEntry" ADD CONSTRAINT "FinanceEntry_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "Farm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceEntry" ADD CONSTRAINT "FinanceEntry_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "AnimalBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceEntry" ADD CONSTRAINT "FinanceEntry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Invariants: a positive amount, a category of the entry's kind (the two lists of finance-categories.ts; a spec keeps them equal), a lot only on an expense of the poultry or pig activity, a label with text.
ALTER TABLE "FinanceEntry" ADD CONSTRAINT "FinanceEntry_amount_check" CHECK ("amount" > 0);
ALTER TABLE "FinanceEntry" ADD CONSTRAINT "FinanceEntry_label_check" CHECK (btrim("label") <> '');
ALTER TABLE "FinanceEntry" ADD CONSTRAINT "FinanceEntry_category_check" CHECK (
  ("kind" = 'DEPENSE' AND "category" IN ('ANIMAUX', 'ALIMENT', 'SANTE', 'MATERIEL', 'CONSOMMABLES', 'SALAIRES', 'ENERGIE', 'EAU', 'TRANSPORT', 'ENTRETIEN', 'AUTRE_CHARGE'))
  OR ("kind" = 'RECETTE' AND "category" IN ('VENTE_ANIMAUX', 'VENTE_OEUFS', 'VENTE_ARTICLES', 'PRESTATIONS', 'AUTRE_RECETTE'))
);
ALTER TABLE "FinanceEntry" ADD CONSTRAINT "FinanceEntry_batchId_check" CHECK ("batchId" IS NULL OR ("kind" = 'DEPENSE' AND "activity" <> 'GENERAL'));

-- The finance ledger: ONE row per manual entry and per derived figure, read by the entries list, the summary and the dashboard (never copied, never written).
--   MANUEL  a FinanceEntry
--   ACHAT   a received purchase, per expense category snapshotted at reception, at the reception date
--   LOT     the purchase price of a lot, at its entry date (category ANIMAUX, the lot's activity)
--   FACTURE an issued invoice, per line activity and category, at the invoice date
--   AVOIR   a credit note, per line activity and category, negative, at the credit note date
-- Payments, supplier payments and stock consumption are not in it.
CREATE VIEW "FinanceLedgerView" AS
  SELECT e."id", e."farmId", e."date", e."kind", e."label", e."activity", e."category", e."amount",
         'MANUEL'::text AS "origin", NULL::text AS "sourceId", e."batchId", e."note"
  FROM "FinanceEntry" e
UNION ALL
  SELECT 'achat:' || p."id" || ':' || i."expenseCategory"::text, p."farmId", p."receivedDate",
         'DEPENSE'::"FinanceKind",
         'Achat ' || COALESCE(p."orderNumber", p."reference") || ' — ' || s."name",
         p."activity", i."expenseCategory", SUM(i."amount"),
         'ACHAT'::text, p."id", NULL::text, NULL::text
  FROM "Purchase" p
  JOIN "PurchaseItem" i ON i."purchaseId" = p."id"
  JOIN "Supplier" s ON s."id" = p."supplierId"
  WHERE p."status" IN ('RECUE', 'PAYEE') AND p."receivedDate" IS NOT NULL AND i."expenseCategory" IS NOT NULL
  GROUP BY p."id", p."farmId", p."receivedDate", p."orderNumber", p."reference", s."name", p."activity", i."expenseCategory"
  HAVING SUM(i."amount") > 0
UNION ALL
  SELECT 'lot:' || b."id", b."farmId", b."entryDate", 'DEPENSE'::"FinanceKind",
         'Achat du lot ' || b."code",
         (CASE b."species" WHEN 'AVICOLE' THEN 'AVICOLE' WHEN 'PORCIN' THEN 'PORCIN' END)::"Activity",
         'ANIMAUX'::"FinanceCategory", b."purchasePrice",
         'LOT'::text, b."id", b."id", NULL::text
  FROM "AnimalBatch" b
  WHERE b."purchasePrice" > 0
UNION ALL
  SELECT 'facture:' || inv."id" || ':' || l."activity"::text || ':' || l."revenueCategory"::text, inv."farmId", inv."date",
         'RECETTE'::"FinanceKind",
         'Facture ' || inv."number" || ' — ' || c."name",
         l."activity", l."revenueCategory", SUM(l."amount"),
         'FACTURE'::text, inv."id", NULL::text, NULL::text
  FROM "Invoice" inv
  JOIN "InvoiceLine" l ON l."invoiceId" = inv."id"
  JOIN "Customer" c ON c."id" = inv."customerId"
  WHERE inv."status" IN ('EMISE', 'PARTIELLE', 'SOLDEE')
  GROUP BY inv."id", inv."farmId", inv."date", inv."number", c."name", l."activity", l."revenueCategory"
  HAVING SUM(l."amount") <> 0
UNION ALL
  SELECT 'avoir:' || cn."id" || ':' || il."activity"::text || ':' || il."revenueCategory"::text, cn."farmId", cn."date",
         'RECETTE'::"FinanceKind",
         'Avoir ' || cn."number" || ' — ' || c."name" || ' (' || inv."number" || ')',
         il."activity", il."revenueCategory", -SUM(cl."amount"),
         'AVOIR'::text, NULL::text, NULL::text, NULL::text
  FROM "CreditNote" cn
  JOIN "CreditNoteLine" cl ON cl."creditNoteId" = cn."id"
  JOIN "InvoiceLine" il ON il."id" = cl."invoiceLineId"
  JOIN "Invoice" inv ON inv."id" = cn."invoiceId"
  JOIN "Customer" c ON c."id" = inv."customerId"
  WHERE inv."status" IN ('EMISE', 'PARTIELLE', 'SOLDEE')
  GROUP BY cn."id", cn."farmId", cn."date", cn."number", c."name", inv."number", il."activity", il."revenueCategory"
  HAVING SUM(cl."amount") <> 0;
