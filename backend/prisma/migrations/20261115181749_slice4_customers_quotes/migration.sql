-- CreateEnum
CREATE TYPE "CustomerType" AS ENUM ('PARTICULIER', 'REVENDEUR', 'RESTAURANT', 'GROSSISTE');

-- CreateEnum
CREATE TYPE "SaleLineKind" AS ENUM ('LOT', 'ANIMAL', 'OEUFS', 'ARTICLE', 'SERVICE');

-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('BROUILLON', 'ENVOYE', 'ACCEPTE', 'REFUSE', 'FACTURE');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('BROUILLON', 'EMISE', 'PARTIELLE', 'SOLDEE', 'ANNULEE');

-- CreateEnum
CREATE TYPE "CustomerPaymentKind" AS ENUM ('ENCAISSEMENT', 'REMBOURSEMENT');

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "CustomerType" NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "city" TEXT,
    "address" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quote" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "farmId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "validUntil" DATE,
    "status" "QuoteStatus" NOT NULL DEFAULT 'BROUILLON',
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "sentById" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "refusedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "invoiceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteLine" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
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

    CONSTRAINT "QuoteLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Customer_organizationId_name_key" ON "Customer"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Quote_invoiceId_key" ON "Quote"("invoiceId");

-- CreateIndex
CREATE INDEX "Quote_farmId_idx" ON "Quote"("farmId");

-- CreateIndex
CREATE INDEX "Quote_customerId_idx" ON "Quote"("customerId");

-- CreateIndex
CREATE INDEX "Quote_createdById_idx" ON "Quote"("createdById");

-- CreateIndex
CREATE INDEX "Quote_sentById_idx" ON "Quote"("sentById");

-- CreateIndex
CREATE INDEX "Quote_decidedById_idx" ON "Quote"("decidedById");

-- CreateIndex
CREATE INDEX "Quote_farmId_status_idx" ON "Quote"("farmId", "status");

-- CreateIndex
CREATE INDEX "Quote_farmId_date_idx" ON "Quote"("farmId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Quote_organizationId_reference_key" ON "Quote"("organizationId", "reference");

-- CreateIndex
CREATE INDEX "QuoteLine_batchId_idx" ON "QuoteLine"("batchId");

-- CreateIndex
CREATE INDEX "QuoteLine_animalId_idx" ON "QuoteLine"("animalId");

-- CreateIndex
CREATE INDEX "QuoteLine_stockItemId_idx" ON "QuoteLine"("stockItemId");

-- CreateIndex
CREATE UNIQUE INDEX "QuoteLine_quoteId_position_key" ON "QuoteLine"("quoteId", "position");

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "Farm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "AnimalBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "Animal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "StockItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Invariants of a quote and its lines, enforced by the database as well as by the service.
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_total_check" CHECK ("total" >= 0);
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_validUntil_check" CHECK ("validUntil" IS NULL OR "validUntil" >= "date");

ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_position_check" CHECK ("position" >= 0);
ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_quantity_check" CHECK ("quantity" > 0);
ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_unitPrice_check" CHECK ("unitPrice" >= 0);
ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_amount_check" CHECK ("amount" = ROUND("quantity" * "unitPrice", 2));
ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_weightKg_check" CHECK ("weightKg" IS NULL OR ("weightKg" > 0 AND "kind" IN ('LOT', 'ANIMAL')));
ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_designation_check" CHECK (btrim("designation") <> '');
-- A line names its source, and only the source its kind allows.
ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_kind_check" CHECK (
  CASE "kind"
    WHEN 'LOT' THEN "batchId" IS NOT NULL AND "animalId" IS NULL AND "stockItemId" IS NULL AND "eggsPerUnit" IS NULL AND "quantity" = TRUNC("quantity")
    WHEN 'ANIMAL' THEN "animalId" IS NOT NULL AND "batchId" IS NULL AND "stockItemId" IS NULL AND "eggsPerUnit" IS NULL AND "quantity" = 1
    WHEN 'OEUFS' THEN "batchId" IS NOT NULL AND "eggsPerUnit" IS NOT NULL AND "eggsPerUnit" > 0 AND "animalId" IS NULL AND "stockItemId" IS NULL AND "quantity" = TRUNC("quantity")
    WHEN 'ARTICLE' THEN "stockItemId" IS NOT NULL AND "batchId" IS NULL AND "animalId" IS NULL AND "eggsPerUnit" IS NULL
    WHEN 'SERVICE' THEN "batchId" IS NULL AND "animalId" IS NULL AND "stockItemId" IS NULL AND "eggsPerUnit" IS NULL
  END
);
