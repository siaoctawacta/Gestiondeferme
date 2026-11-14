-- CreateEnum
CREATE TYPE "Species" AS ENUM ('AVICOLE', 'PORCIN');

-- CreateEnum
CREATE TYPE "BatchType" AS ENUM ('CHAIR', 'PONDEUSE', 'POUSSIN', 'REPRODUCTEUR', 'PORCELET', 'ENGRAISSEMENT');

-- CreateEnum
CREATE TYPE "BatchStatus" AS ENUM ('EN_COURS', 'CLOTURE');

-- CreateEnum
CREATE TYPE "BatchEventType" AS ENUM ('ENTREE', 'NAISSANCE', 'MORTALITE', 'VENTE', 'TRANSFERT_SORTIE', 'TRANSFERT_ENTREE', 'REFORME');

-- CreateTable
CREATE TABLE "Breed" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "species" "Species" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Breed_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnimalBatch" (
    "id" TEXT NOT NULL,
    "farmId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "species" "Species" NOT NULL,
    "type" "BatchType" NOT NULL,
    "breedId" TEXT,
    "buildingId" TEXT NOT NULL,
    "entryDate" DATE NOT NULL,
    "initialCount" INTEGER NOT NULL,
    "supplierName" TEXT,
    "purchasePrice" DECIMAL(14,2),
    "responsibleId" TEXT,
    "status" "BatchStatus" NOT NULL DEFAULT 'EN_COURS',
    "closedAt" TIMESTAMP(3),
    "motherAnimalId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnimalBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BatchEvent" (
    "id" TEXT NOT NULL,
    "farmId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "type" "BatchEventType" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "cause" TEXT,
    "note" TEXT,
    "relatedBatchId" TEXT,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BatchEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Weighing" (
    "id" TEXT NOT NULL,
    "farmId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "sampleSize" INTEGER NOT NULL,
    "averageWeightG" INTEGER NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Weighing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Breed_organizationId_species_name_key" ON "Breed"("organizationId", "species", "name");

-- CreateIndex
CREATE INDEX "AnimalBatch_farmId_idx" ON "AnimalBatch"("farmId");

-- CreateIndex
CREATE INDEX "AnimalBatch_breedId_idx" ON "AnimalBatch"("breedId");

-- CreateIndex
CREATE INDEX "AnimalBatch_buildingId_idx" ON "AnimalBatch"("buildingId");

-- CreateIndex
CREATE INDEX "AnimalBatch_responsibleId_idx" ON "AnimalBatch"("responsibleId");

-- CreateIndex
CREATE UNIQUE INDEX "AnimalBatch_farmId_code_key" ON "AnimalBatch"("farmId", "code");

-- CreateIndex
CREATE INDEX "BatchEvent_farmId_idx" ON "BatchEvent"("farmId");

-- CreateIndex
CREATE INDEX "BatchEvent_batchId_date_idx" ON "BatchEvent"("batchId", "date");

-- CreateIndex
CREATE INDEX "BatchEvent_relatedBatchId_idx" ON "BatchEvent"("relatedBatchId");

-- CreateIndex
CREATE INDEX "BatchEvent_createdById_idx" ON "BatchEvent"("createdById");

-- CreateIndex
CREATE INDEX "Weighing_farmId_idx" ON "Weighing"("farmId");

-- CreateIndex
CREATE INDEX "Weighing_batchId_date_idx" ON "Weighing"("batchId", "date");

-- AddForeignKey
ALTER TABLE "Breed" ADD CONSTRAINT "Breed_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnimalBatch" ADD CONSTRAINT "AnimalBatch_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "Farm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnimalBatch" ADD CONSTRAINT "AnimalBatch_breedId_fkey" FOREIGN KEY ("breedId") REFERENCES "Breed"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnimalBatch" ADD CONSTRAINT "AnimalBatch_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnimalBatch" ADD CONSTRAINT "AnimalBatch_responsibleId_fkey" FOREIGN KEY ("responsibleId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchEvent" ADD CONSTRAINT "BatchEvent_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "Farm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchEvent" ADD CONSTRAINT "BatchEvent_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "AnimalBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchEvent" ADD CONSTRAINT "BatchEvent_relatedBatchId_fkey" FOREIGN KEY ("relatedBatchId") REFERENCES "AnimalBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchEvent" ADD CONSTRAINT "BatchEvent_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Weighing" ADD CONSTRAINT "Weighing_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "Farm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Weighing" ADD CONSTRAINT "Weighing_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "AnimalBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Business invariants the application also checks
ALTER TABLE "AnimalBatch" ADD CONSTRAINT "AnimalBatch_initialCount_positive" CHECK ("initialCount" > 0);
ALTER TABLE "BatchEvent" ADD CONSTRAINT "BatchEvent_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "Weighing" ADD CONSTRAINT "Weighing_sampleSize_positive" CHECK ("sampleSize" > 0);
ALTER TABLE "Weighing" ADD CONSTRAINT "Weighing_averageWeightG_positive" CHECK ("averageWeightG" > 0);
