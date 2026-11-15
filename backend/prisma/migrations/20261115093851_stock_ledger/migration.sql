-- CreateEnum
CREATE TYPE "StockCategory" AS ENUM ('ALIMENT', 'MEDICAMENT', 'VACCIN', 'MATERIEL', 'CONSOMMABLE');

-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('ENTREE', 'SORTIE', 'AJUSTEMENT', 'TRANSFERT_SORTIE', 'TRANSFERT_ENTREE');

-- CreateEnum
CREATE TYPE "StockReason" AS ENUM ('ACHAT', 'CONSOMMATION', 'TRAITEMENT', 'INVENTAIRE', 'PERTE', 'AUTRE');

-- CreateEnum
CREATE TYPE "InventoryStatus" AS ENUM ('BROUILLON', 'VALIDEE');

-- CreateTable
CREATE TABLE "StockItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "StockCategory" NOT NULL,
    "unit" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FarmStockItem" (
    "id" TEXT NOT NULL,
    "farmId" TEXT NOT NULL,
    "stockItemId" TEXT NOT NULL,
    "minQty" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "maxQty" DECIMAL(12,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FarmStockItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockBatch" (
    "id" TEXT NOT NULL,
    "farmId" TEXT NOT NULL,
    "stockItemId" TEXT NOT NULL,
    "lotNumber" TEXT,
    "expiryDate" DATE,
    "receivedDate" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL,
    "farmId" TEXT NOT NULL,
    "stockItemId" TEXT NOT NULL,
    "stockBatchId" TEXT,
    "date" DATE NOT NULL,
    "type" "StockMovementType" NOT NULL,
    "quantity" DECIMAL(12,2) NOT NULL,
    "unitCost" DECIMAL(12,2) NOT NULL,
    "reason" "StockReason" NOT NULL,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventorySession" (
    "id" TEXT NOT NULL,
    "farmId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" "InventoryStatus" NOT NULL DEFAULT 'BROUILLON',
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "validatedById" TEXT,
    "validatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventorySession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryLine" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "stockItemId" TEXT NOT NULL,
    "theoreticalQty" DECIMAL(12,2) NOT NULL,
    "countedQty" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "InventoryLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StockItem_organizationId_name_key" ON "StockItem"("organizationId", "name");

-- CreateIndex
CREATE INDEX "FarmStockItem_farmId_idx" ON "FarmStockItem"("farmId");

-- CreateIndex
CREATE INDEX "FarmStockItem_stockItemId_idx" ON "FarmStockItem"("stockItemId");

-- CreateIndex
CREATE UNIQUE INDEX "FarmStockItem_farmId_stockItemId_key" ON "FarmStockItem"("farmId", "stockItemId");

-- CreateIndex
CREATE INDEX "StockBatch_farmId_idx" ON "StockBatch"("farmId");

-- CreateIndex
CREATE INDEX "StockBatch_stockItemId_idx" ON "StockBatch"("stockItemId");

-- CreateIndex
CREATE INDEX "StockBatch_farmId_stockItemId_idx" ON "StockBatch"("farmId", "stockItemId");

-- CreateIndex
CREATE INDEX "StockMovement_farmId_idx" ON "StockMovement"("farmId");

-- CreateIndex
CREATE INDEX "StockMovement_stockItemId_idx" ON "StockMovement"("stockItemId");

-- CreateIndex
CREATE INDEX "StockMovement_stockBatchId_idx" ON "StockMovement"("stockBatchId");

-- CreateIndex
CREATE INDEX "StockMovement_createdById_idx" ON "StockMovement"("createdById");

-- CreateIndex
CREATE INDEX "StockMovement_farmId_stockItemId_date_idx" ON "StockMovement"("farmId", "stockItemId", "date");

-- CreateIndex
CREATE INDEX "StockMovement_sourceType_sourceId_idx" ON "StockMovement"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "InventorySession_farmId_idx" ON "InventorySession"("farmId");

-- CreateIndex
CREATE INDEX "InventorySession_createdById_idx" ON "InventorySession"("createdById");

-- CreateIndex
CREATE INDEX "InventorySession_validatedById_idx" ON "InventorySession"("validatedById");

-- CreateIndex
CREATE INDEX "InventoryLine_stockItemId_idx" ON "InventoryLine"("stockItemId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryLine_sessionId_stockItemId_key" ON "InventoryLine"("sessionId", "stockItemId");

-- AddForeignKey
ALTER TABLE "StockItem" ADD CONSTRAINT "StockItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FarmStockItem" ADD CONSTRAINT "FarmStockItem_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "Farm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FarmStockItem" ADD CONSTRAINT "FarmStockItem_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "StockItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockBatch" ADD CONSTRAINT "StockBatch_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "Farm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockBatch" ADD CONSTRAINT "StockBatch_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "StockItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "Farm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "StockItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_stockBatchId_fkey" FOREIGN KEY ("stockBatchId") REFERENCES "StockBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventorySession" ADD CONSTRAINT "InventorySession_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "Farm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventorySession" ADD CONSTRAINT "InventorySession_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventorySession" ADD CONSTRAINT "InventorySession_validatedById_fkey" FOREIGN KEY ("validatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryLine" ADD CONSTRAINT "InventoryLine_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "InventorySession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryLine" ADD CONSTRAINT "InventoryLine_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "StockItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Invariants the services also enforce (with French messages); the database is the last line.
ALTER TABLE "FarmStockItem" ADD CONSTRAINT "FarmStockItem_minQty_check" CHECK ("minQty" >= 0);
ALTER TABLE "FarmStockItem" ADD CONSTRAINT "FarmStockItem_maxQty_check" CHECK ("maxQty" IS NULL OR "maxQty" >= "minQty");
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_quantity_check" CHECK ("quantity" <> 0);
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_unitCost_check" CHECK ("unitCost" >= 0);
-- Type and sign agree: entries are positive, exits negative, an adjustment goes either way.
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_type_sign_check" CHECK (
  ("type" IN ('ENTREE', 'TRANSFERT_ENTREE') AND "quantity" > 0)
  OR ("type" IN ('SORTIE', 'TRANSFERT_SORTIE') AND "quantity" < 0)
  OR "type" = 'AJUSTEMENT'
);
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_source_check" CHECK (("sourceType" IS NULL) = ("sourceId" IS NULL));
ALTER TABLE "InventoryLine" ADD CONSTRAINT "InventoryLine_theoreticalQty_check" CHECK ("theoreticalQty" >= 0);
ALTER TABLE "InventoryLine" ADD CONSTRAINT "InventoryLine_countedQty_check" CHECK ("countedQty" >= 0);
ALTER TABLE "InventorySession" ADD CONSTRAINT "InventorySession_validated_check" CHECK (("status" = 'VALIDEE') = ("validatedAt" IS NOT NULL AND "validatedById" IS NOT NULL));
