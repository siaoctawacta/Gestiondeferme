-- CreateEnum
CREATE TYPE "AnimalCategory" AS ENUM ('TRUIE', 'VERRAT', 'COCHETTE');

-- CreateEnum
CREATE TYPE "AnimalSex" AS ENUM ('F', 'M');

-- CreateEnum
CREATE TYPE "AnimalStatus" AS ENUM ('ACTIF', 'GESTANTE', 'ALLAITANTE', 'VENDU', 'MORT', 'REFORME');

-- CreateEnum
CREATE TYPE "AnimalExitReason" AS ENUM ('VENDU', 'MORT', 'REFORME');

-- CreateEnum
CREATE TYPE "BreedingMethod" AS ENUM ('SAILLIE', 'IA');

-- CreateEnum
CREATE TYPE "BreedingStatus" AS ENUM ('GESTATION', 'MISE_BAS', 'SEVRAGE', 'ECHEC');

-- CreateTable
CREATE TABLE "Animal" (
    "id" TEXT NOT NULL,
    "farmId" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "category" "AnimalCategory" NOT NULL,
    "breedId" TEXT,
    "sex" "AnimalSex" NOT NULL,
    "birthDate" DATE,
    "sireId" TEXT,
    "damId" TEXT,
    "buildingId" TEXT NOT NULL,
    "status" "AnimalStatus" NOT NULL DEFAULT 'ACTIF',
    "exitDate" DATE,
    "exitReason" "AnimalExitReason",
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Animal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnimalWeighing" (
    "id" TEXT NOT NULL,
    "farmId" TEXT NOT NULL,
    "animalId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "weightKg" DECIMAL(6,1) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnimalWeighing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Heat" (
    "id" TEXT NOT NULL,
    "farmId" TEXT NOT NULL,
    "animalId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Heat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BreedingRecord" (
    "id" TEXT NOT NULL,
    "farmId" TEXT NOT NULL,
    "sowId" TEXT NOT NULL,
    "method" "BreedingMethod" NOT NULL,
    "boarId" TEXT,
    "semenLabel" TEXT,
    "serviceDate" DATE NOT NULL,
    "expectedFarrowingDate" DATE NOT NULL,
    "status" "BreedingStatus" NOT NULL DEFAULT 'GESTATION',
    "farrowingDate" DATE,
    "bornTotal" INTEGER,
    "bornAlive" INTEGER,
    "stillborn" INTEGER,
    "litterBatchId" TEXT,
    "weaningDate" DATE,
    "weanedCount" INTEGER,
    "failureDate" DATE,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BreedingRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Animal_farmId_idx" ON "Animal"("farmId");

-- CreateIndex
CREATE INDEX "Animal_breedId_idx" ON "Animal"("breedId");

-- CreateIndex
CREATE INDEX "Animal_sireId_idx" ON "Animal"("sireId");

-- CreateIndex
CREATE INDEX "Animal_damId_idx" ON "Animal"("damId");

-- CreateIndex
CREATE INDEX "Animal_buildingId_idx" ON "Animal"("buildingId");

-- CreateIndex
CREATE UNIQUE INDEX "Animal_farmId_tag_key" ON "Animal"("farmId", "tag");

-- CreateIndex
CREATE INDEX "AnimalWeighing_farmId_idx" ON "AnimalWeighing"("farmId");

-- CreateIndex
CREATE INDEX "AnimalWeighing_animalId_date_idx" ON "AnimalWeighing"("animalId", "date");

-- CreateIndex
CREATE INDEX "Heat_farmId_idx" ON "Heat"("farmId");

-- CreateIndex
CREATE INDEX "Heat_animalId_date_idx" ON "Heat"("animalId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "BreedingRecord_litterBatchId_key" ON "BreedingRecord"("litterBatchId");

-- CreateIndex
CREATE INDEX "BreedingRecord_farmId_idx" ON "BreedingRecord"("farmId");

-- CreateIndex
CREATE INDEX "BreedingRecord_farmId_serviceDate_idx" ON "BreedingRecord"("farmId", "serviceDate");

-- CreateIndex
CREATE INDEX "BreedingRecord_sowId_idx" ON "BreedingRecord"("sowId");

-- CreateIndex
CREATE INDEX "BreedingRecord_boarId_idx" ON "BreedingRecord"("boarId");

-- CreateIndex
CREATE INDEX "AnimalBatch_motherAnimalId_idx" ON "AnimalBatch"("motherAnimalId");

-- AddForeignKey
ALTER TABLE "AnimalBatch" ADD CONSTRAINT "AnimalBatch_motherAnimalId_fkey" FOREIGN KEY ("motherAnimalId") REFERENCES "Animal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Animal" ADD CONSTRAINT "Animal_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "Farm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Animal" ADD CONSTRAINT "Animal_breedId_fkey" FOREIGN KEY ("breedId") REFERENCES "Breed"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Animal" ADD CONSTRAINT "Animal_sireId_fkey" FOREIGN KEY ("sireId") REFERENCES "Animal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Animal" ADD CONSTRAINT "Animal_damId_fkey" FOREIGN KEY ("damId") REFERENCES "Animal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Animal" ADD CONSTRAINT "Animal_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnimalWeighing" ADD CONSTRAINT "AnimalWeighing_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "Farm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnimalWeighing" ADD CONSTRAINT "AnimalWeighing_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "Animal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Heat" ADD CONSTRAINT "Heat_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "Farm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Heat" ADD CONSTRAINT "Heat_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "Animal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BreedingRecord" ADD CONSTRAINT "BreedingRecord_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "Farm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BreedingRecord" ADD CONSTRAINT "BreedingRecord_sowId_fkey" FOREIGN KEY ("sowId") REFERENCES "Animal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BreedingRecord" ADD CONSTRAINT "BreedingRecord_boarId_fkey" FOREIGN KEY ("boarId") REFERENCES "Animal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BreedingRecord" ADD CONSTRAINT "BreedingRecord_litterBatchId_fkey" FOREIGN KEY ("litterBatchId") REFERENCES "AnimalBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A weight is always positive.
ALTER TABLE "AnimalWeighing" ADD CONSTRAINT "AnimalWeighing_weightKg_positive" CHECK ("weightKg" > 0);
