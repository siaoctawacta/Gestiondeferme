-- CreateEnum
CREATE TYPE "HealthActType" AS ENUM ('VACCINATION', 'TRAITEMENT', 'DESINFECTION', 'DIAGNOSTIC');

-- CreateEnum
CREATE TYPE "HealthActStatus" AS ENUM ('PLANIFIE', 'REALISE', 'ANNULE');

-- CreateEnum
CREATE TYPE "QuarantineStatus" AS ENUM ('EN_COURS', 'LEVEE');

-- CreateEnum
CREATE TYPE "IncidentSeverity" AS ENUM ('FAIBLE', 'MOYENNE', 'GRAVE');

-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('OUVERT', 'CLOS');

-- CreateEnum
CREATE TYPE "BiosecurityType" AS ENUM ('NETTOYAGE', 'DESINFECTION', 'PEDILUVE', 'VISITEUR');

-- CreateTable
CREATE TABLE "HealthAct" (
    "id" TEXT NOT NULL,
    "farmId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "type" "HealthActType" NOT NULL,
    "batchId" TEXT,
    "animalId" TEXT,
    "buildingId" TEXT,
    "stockItemId" TEXT,
    "stockBatchId" TEXT,
    "productName" TEXT,
    "dose" TEXT,
    "quantity" DECIMAL(12,2),
    "durationDays" INTEGER,
    "withdrawalDays" INTEGER,
    "veterinarian" TEXT,
    "symptoms" TEXT,
    "diagnosis" TEXT,
    "status" "HealthActStatus" NOT NULL DEFAULT 'PLANIFIE',
    "doneDate" DATE,
    "planId" TEXT,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HealthAct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VaccinationPlan" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "species" "Species" NOT NULL,
    "type" "BatchType",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VaccinationPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VaccinationPlanItem" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "ageDays" INTEGER NOT NULL,
    "productName" TEXT NOT NULL,
    "stockItemId" TEXT,
    "dose" TEXT,

    CONSTRAINT "VaccinationPlanItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quarantine" (
    "id" TEXT NOT NULL,
    "farmId" TEXT NOT NULL,
    "batchId" TEXT,
    "animalId" TEXT,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "reason" TEXT NOT NULL,
    "status" "QuarantineStatus" NOT NULL DEFAULT 'EN_COURS',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Quarantine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HealthIncident" (
    "id" TEXT NOT NULL,
    "farmId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "severity" "IncidentSeverity" NOT NULL,
    "batchId" TEXT,
    "buildingId" TEXT,
    "status" "IncidentStatus" NOT NULL DEFAULT 'OUVERT',
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HealthIncident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BiosecurityLog" (
    "id" TEXT NOT NULL,
    "farmId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "type" "BiosecurityType" NOT NULL,
    "buildingId" TEXT,
    "productName" TEXT,
    "visitorName" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BiosecurityLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HealthAct_farmId_idx" ON "HealthAct"("farmId");

-- CreateIndex
CREATE INDEX "HealthAct_farmId_date_idx" ON "HealthAct"("farmId", "date");

-- CreateIndex
CREATE INDEX "HealthAct_batchId_idx" ON "HealthAct"("batchId");

-- CreateIndex
CREATE INDEX "HealthAct_animalId_idx" ON "HealthAct"("animalId");

-- CreateIndex
CREATE INDEX "HealthAct_buildingId_idx" ON "HealthAct"("buildingId");

-- CreateIndex
CREATE INDEX "HealthAct_stockItemId_idx" ON "HealthAct"("stockItemId");

-- CreateIndex
CREATE INDEX "HealthAct_stockBatchId_idx" ON "HealthAct"("stockBatchId");

-- CreateIndex
CREATE INDEX "HealthAct_planId_idx" ON "HealthAct"("planId");

-- CreateIndex
CREATE INDEX "HealthAct_createdById_idx" ON "HealthAct"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "VaccinationPlan_organizationId_name_key" ON "VaccinationPlan"("organizationId", "name");

-- CreateIndex
CREATE INDEX "VaccinationPlanItem_planId_idx" ON "VaccinationPlanItem"("planId");

-- CreateIndex
CREATE INDEX "VaccinationPlanItem_stockItemId_idx" ON "VaccinationPlanItem"("stockItemId");

-- CreateIndex
CREATE INDEX "Quarantine_farmId_idx" ON "Quarantine"("farmId");

-- CreateIndex
CREATE INDEX "Quarantine_batchId_idx" ON "Quarantine"("batchId");

-- CreateIndex
CREATE INDEX "Quarantine_animalId_idx" ON "Quarantine"("animalId");

-- CreateIndex
CREATE INDEX "HealthIncident_farmId_idx" ON "HealthIncident"("farmId");

-- CreateIndex
CREATE INDEX "HealthIncident_farmId_date_idx" ON "HealthIncident"("farmId", "date");

-- CreateIndex
CREATE INDEX "HealthIncident_batchId_idx" ON "HealthIncident"("batchId");

-- CreateIndex
CREATE INDEX "HealthIncident_buildingId_idx" ON "HealthIncident"("buildingId");

-- CreateIndex
CREATE INDEX "BiosecurityLog_farmId_idx" ON "BiosecurityLog"("farmId");

-- CreateIndex
CREATE INDEX "BiosecurityLog_farmId_date_idx" ON "BiosecurityLog"("farmId", "date");

-- CreateIndex
CREATE INDEX "BiosecurityLog_buildingId_idx" ON "BiosecurityLog"("buildingId");

-- AddForeignKey
ALTER TABLE "HealthAct" ADD CONSTRAINT "HealthAct_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "Farm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthAct" ADD CONSTRAINT "HealthAct_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "AnimalBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthAct" ADD CONSTRAINT "HealthAct_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "Animal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthAct" ADD CONSTRAINT "HealthAct_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthAct" ADD CONSTRAINT "HealthAct_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "StockItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthAct" ADD CONSTRAINT "HealthAct_stockBatchId_fkey" FOREIGN KEY ("stockBatchId") REFERENCES "StockBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthAct" ADD CONSTRAINT "HealthAct_planId_fkey" FOREIGN KEY ("planId") REFERENCES "VaccinationPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthAct" ADD CONSTRAINT "HealthAct_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaccinationPlan" ADD CONSTRAINT "VaccinationPlan_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaccinationPlanItem" ADD CONSTRAINT "VaccinationPlanItem_planId_fkey" FOREIGN KEY ("planId") REFERENCES "VaccinationPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaccinationPlanItem" ADD CONSTRAINT "VaccinationPlanItem_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "StockItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quarantine" ADD CONSTRAINT "Quarantine_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "Farm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quarantine" ADD CONSTRAINT "Quarantine_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "AnimalBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quarantine" ADD CONSTRAINT "Quarantine_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "Animal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthIncident" ADD CONSTRAINT "HealthIncident_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "Farm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthIncident" ADD CONSTRAINT "HealthIncident_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "AnimalBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthIncident" ADD CONSTRAINT "HealthIncident_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BiosecurityLog" ADD CONSTRAINT "BiosecurityLog_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "Farm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BiosecurityLog" ADD CONSTRAINT "BiosecurityLog_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Invariants the services also enforce; the database is the last line.
ALTER TABLE "HealthAct" ADD CONSTRAINT "HealthAct_target_check" CHECK (num_nonnulls("batchId", "animalId", "buildingId") = 1);
ALTER TABLE "HealthAct" ADD CONSTRAINT "HealthAct_disinfection_check" CHECK (("type" = 'DESINFECTION') = ("buildingId" IS NOT NULL));
ALTER TABLE "HealthAct" ADD CONSTRAINT "HealthAct_quantity_check" CHECK ("quantity" IS NULL OR "quantity" >= 0);
ALTER TABLE "HealthAct" ADD CONSTRAINT "HealthAct_durationDays_check" CHECK ("durationDays" IS NULL OR "durationDays" >= 0);
ALTER TABLE "HealthAct" ADD CONSTRAINT "HealthAct_withdrawalDays_check" CHECK ("withdrawalDays" IS NULL OR "withdrawalDays" >= 0);
ALTER TABLE "HealthAct" ADD CONSTRAINT "HealthAct_done_check" CHECK (("status" = 'REALISE') = ("doneDate" IS NOT NULL));
ALTER TABLE "HealthAct" ADD CONSTRAINT "HealthAct_stock_check" CHECK (
  ("quantity" IS NULL OR "stockItemId" IS NOT NULL)
  AND ("stockBatchId" IS NULL OR ("stockItemId" IS NOT NULL AND "status" = 'REALISE'))
);
ALTER TABLE "VaccinationPlanItem" ADD CONSTRAINT "VaccinationPlanItem_ageDays_check" CHECK ("ageDays" >= 0);
ALTER TABLE "Quarantine" ADD CONSTRAINT "Quarantine_target_check" CHECK (num_nonnulls("batchId", "animalId") = 1);
ALTER TABLE "Quarantine" ADD CONSTRAINT "Quarantine_dates_check" CHECK ("endDate" IS NULL OR "endDate" >= "startDate");
ALTER TABLE "Quarantine" ADD CONSTRAINT "Quarantine_lifted_check" CHECK ("status" <> 'LEVEE' OR "endDate" IS NOT NULL);
ALTER TABLE "HealthIncident" ADD CONSTRAINT "HealthIncident_closed_check" CHECK (("status" = 'CLOS') = ("closedAt" IS NOT NULL));
