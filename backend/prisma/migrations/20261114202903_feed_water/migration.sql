-- CreateEnum
CREATE TYPE "FeedKind" AS ENUM ('MATIERE_PREMIERE', 'ALIMENT_COMPLET');

-- CreateTable
CREATE TABLE "FeedProduct" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "FeedKind" NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'kg',
    "unitCost" DECIMAL(12,2) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeedProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeedFormula" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "species" "Species" NOT NULL,
    "stage" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeedFormula_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeedFormulaItem" (
    "id" TEXT NOT NULL,
    "formulaId" TEXT NOT NULL,
    "feedProductId" TEXT NOT NULL,
    "percentage" DECIMAL(5,2) NOT NULL,

    CONSTRAINT "FeedFormulaItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeedDistribution" (
    "id" TEXT NOT NULL,
    "farmId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "batchId" TEXT,
    "buildingId" TEXT,
    "feedProductId" TEXT,
    "formulaId" TEXT,
    "quantityKg" DECIMAL(10,2) NOT NULL,
    "unitCost" DECIMAL(12,2) NOT NULL,
    "cost" DECIMAL(14,2) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeedDistribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaterConsumption" (
    "id" TEXT NOT NULL,
    "farmId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "batchId" TEXT,
    "buildingId" TEXT,
    "liters" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WaterConsumption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FeedProduct_organizationId_name_key" ON "FeedProduct"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "FeedFormula_organizationId_name_key" ON "FeedFormula"("organizationId", "name");

-- CreateIndex
CREATE INDEX "FeedFormulaItem_feedProductId_idx" ON "FeedFormulaItem"("feedProductId");

-- CreateIndex
CREATE UNIQUE INDEX "FeedFormulaItem_formulaId_feedProductId_key" ON "FeedFormulaItem"("formulaId", "feedProductId");

-- CreateIndex
CREATE INDEX "FeedDistribution_farmId_idx" ON "FeedDistribution"("farmId");

-- CreateIndex
CREATE INDEX "FeedDistribution_farmId_date_idx" ON "FeedDistribution"("farmId", "date");

-- CreateIndex
CREATE INDEX "FeedDistribution_batchId_idx" ON "FeedDistribution"("batchId");

-- CreateIndex
CREATE INDEX "FeedDistribution_buildingId_idx" ON "FeedDistribution"("buildingId");

-- CreateIndex
CREATE INDEX "FeedDistribution_feedProductId_idx" ON "FeedDistribution"("feedProductId");

-- CreateIndex
CREATE INDEX "FeedDistribution_formulaId_idx" ON "FeedDistribution"("formulaId");

-- CreateIndex
CREATE INDEX "WaterConsumption_farmId_idx" ON "WaterConsumption"("farmId");

-- CreateIndex
CREATE INDEX "WaterConsumption_farmId_date_idx" ON "WaterConsumption"("farmId", "date");

-- CreateIndex
CREATE INDEX "WaterConsumption_batchId_idx" ON "WaterConsumption"("batchId");

-- CreateIndex
CREATE INDEX "WaterConsumption_buildingId_idx" ON "WaterConsumption"("buildingId");

-- CreateIndex
CREATE UNIQUE INDEX "WaterConsumption_batchId_date_key" ON "WaterConsumption"("batchId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "WaterConsumption_buildingId_date_key" ON "WaterConsumption"("buildingId", "date");

-- AddForeignKey
ALTER TABLE "FeedProduct" ADD CONSTRAINT "FeedProduct_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedFormula" ADD CONSTRAINT "FeedFormula_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedFormulaItem" ADD CONSTRAINT "FeedFormulaItem_formulaId_fkey" FOREIGN KEY ("formulaId") REFERENCES "FeedFormula"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedFormulaItem" ADD CONSTRAINT "FeedFormulaItem_feedProductId_fkey" FOREIGN KEY ("feedProductId") REFERENCES "FeedProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedDistribution" ADD CONSTRAINT "FeedDistribution_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "Farm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedDistribution" ADD CONSTRAINT "FeedDistribution_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "AnimalBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedDistribution" ADD CONSTRAINT "FeedDistribution_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedDistribution" ADD CONSTRAINT "FeedDistribution_feedProductId_fkey" FOREIGN KEY ("feedProductId") REFERENCES "FeedProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedDistribution" ADD CONSTRAINT "FeedDistribution_formulaId_fkey" FOREIGN KEY ("formulaId") REFERENCES "FeedFormula"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaterConsumption" ADD CONSTRAINT "WaterConsumption_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "Farm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaterConsumption" ADD CONSTRAINT "WaterConsumption_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "AnimalBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaterConsumption" ADD CONSTRAINT "WaterConsumption_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE SET NULL ON UPDATE CASCADE;
