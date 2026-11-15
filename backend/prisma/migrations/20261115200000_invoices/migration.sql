-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "farmId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "number" TEXT,
    "date" DATE NOT NULL,
    "dueDate" DATE,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'BROUILLON',
    "quoteId" TEXT,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3),
    "issuedById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceLine" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "kind" "SaleLineKind" NOT NULL,
    "batchId" TEXT,
    "animalId" TEXT,
    "stockItemId" TEXT,
    "eggsPerUnit" INTEGER,
    "designation" TEXT NOT NULL,
    "unit" TEXT,
    "quantity" DECIMAL(12,2) NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "weightKg" DECIMAL(12,2),
    "activity" "Activity" NOT NULL,
    "revenueCategory" "FinanceCategory" NOT NULL,
    "exitUnitCost" DECIMAL(12,2),

    CONSTRAINT "InvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_quoteId_key" ON "Invoice"("quoteId");

-- CreateIndex
CREATE INDEX "Invoice_farmId_idx" ON "Invoice"("farmId");

-- CreateIndex
CREATE INDEX "Invoice_customerId_idx" ON "Invoice"("customerId");

-- CreateIndex
CREATE INDEX "Invoice_createdById_idx" ON "Invoice"("createdById");

-- CreateIndex
CREATE INDEX "Invoice_issuedById_idx" ON "Invoice"("issuedById");

-- CreateIndex
CREATE INDEX "Invoice_cancelledById_idx" ON "Invoice"("cancelledById");

-- CreateIndex
CREATE INDEX "Invoice_farmId_status_idx" ON "Invoice"("farmId", "status");

-- CreateIndex
CREATE INDEX "Invoice_farmId_date_idx" ON "Invoice"("farmId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_organizationId_number_key" ON "Invoice"("organizationId", "number");

-- CreateIndex
CREATE INDEX "InvoiceLine_batchId_idx" ON "InvoiceLine"("batchId");

-- CreateIndex
CREATE INDEX "InvoiceLine_animalId_idx" ON "InvoiceLine"("animalId");

-- CreateIndex
CREATE INDEX "InvoiceLine_stockItemId_idx" ON "InvoiceLine"("stockItemId");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceLine_invoiceId_position_key" ON "InvoiceLine"("invoiceId", "position");

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "Farm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "AnimalBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "Animal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "StockItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Invariants of an invoice and its lines, enforced by the database as well as by the service.
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_number_status_check" CHECK (("status" = 'BROUILLON') = ("number" IS NULL));
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_dueDate_check" CHECK ("dueDate" IS NULL OR "dueDate" >= "date");
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_total_check" CHECK ("total" >= 0);

ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_position_check" CHECK ("position" >= 0);
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_quantity_check" CHECK ("quantity" > 0);
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_unitPrice_check" CHECK ("unitPrice" >= 0);
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_amount_check" CHECK ("amount" = ROUND("quantity" * "unitPrice", 2));
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_weightKg_check" CHECK ("weightKg" IS NULL OR ("weightKg" > 0 AND "kind" IN ('LOT', 'ANIMAL')));
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_designation_check" CHECK (btrim("designation") <> '');
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_exitUnitCost_check" CHECK ("exitUnitCost" IS NULL OR ("exitUnitCost" >= 0 AND "kind" = 'ARTICLE'));
-- A line names its source, and only the source its kind allows (same shape as a quote line).
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_kind_check" CHECK (
  CASE "kind"
    WHEN 'LOT' THEN "batchId" IS NOT NULL AND "animalId" IS NULL AND "stockItemId" IS NULL AND "eggsPerUnit" IS NULL AND "quantity" = TRUNC("quantity")
    WHEN 'ANIMAL' THEN "animalId" IS NOT NULL AND "batchId" IS NULL AND "stockItemId" IS NULL AND "eggsPerUnit" IS NULL AND "quantity" = 1
    WHEN 'OEUFS' THEN "batchId" IS NOT NULL AND "eggsPerUnit" IS NOT NULL AND "eggsPerUnit" > 0 AND "animalId" IS NULL AND "stockItemId" IS NULL AND "quantity" = TRUNC("quantity")
    WHEN 'ARTICLE' THEN "stockItemId" IS NOT NULL AND "batchId" IS NULL AND "animalId" IS NULL AND "eggsPerUnit" IS NULL
    WHEN 'SERVICE' THEN "batchId" IS NULL AND "animalId" IS NULL AND "stockItemId" IS NULL AND "eggsPerUnit" IS NULL
  END
);
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_eggUnit_check" CHECK (
  "kind" <> 'OEUFS'
  OR ("unit" IS NOT NULL AND "unit" IN ('PLATEAU', 'OEUF') AND ("unit" <> 'OEUF' OR "eggsPerUnit" = 1))
);
-- What a line is counted as in finance follows its kind.
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_category_check" CHECK (
  "revenueCategory" = CASE "kind"
    WHEN 'LOT' THEN 'VENTE_ANIMAUX'::"FinanceCategory"
    WHEN 'ANIMAL' THEN 'VENTE_ANIMAUX'::"FinanceCategory"
    WHEN 'OEUFS' THEN 'VENTE_OEUFS'::"FinanceCategory"
    WHEN 'ARTICLE' THEN 'VENTE_ARTICLES'::"FinanceCategory"
    WHEN 'SERVICE' THEN 'PRESTATIONS'::"FinanceCategory"
  END
);
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_activity_check" CHECK (
  CASE "kind"
    WHEN 'LOT' THEN "activity" IN ('AVICOLE', 'PORCIN')
    WHEN 'ANIMAL' THEN "activity" = 'PORCIN'
    WHEN 'OEUFS' THEN "activity" = 'AVICOLE'
    ELSE "activity" = 'GENERAL'
  END
);
