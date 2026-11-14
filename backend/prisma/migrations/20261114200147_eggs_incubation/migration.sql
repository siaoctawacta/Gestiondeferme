-- CreateEnum
CREATE TYPE "IncubationStatus" AS ENUM ('EN_COURS', 'ECLOSE', 'ECHEC');

-- CreateTable
CREATE TABLE "EggProduction" (
    "id" TEXT NOT NULL,
    "farmId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "collected" INTEGER NOT NULL,
    "broken" INTEGER NOT NULL DEFAULT 0,
    "downgraded" INTEGER NOT NULL DEFAULT 0,
    "toIncubation" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EggProduction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Incubation" (
    "id" TEXT NOT NULL,
    "farmId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "sourceBatchId" TEXT,
    "incubator" TEXT,
    "startDate" DATE NOT NULL,
    "eggsSet" INTEGER NOT NULL,
    "candlingDate" DATE,
    "fertileEggs" INTEGER,
    "expectedHatchDate" DATE NOT NULL,
    "status" "IncubationStatus" NOT NULL DEFAULT 'EN_COURS',
    "hatchDate" DATE,
    "chicksHatched" INTEGER,
    "chickBatchId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Incubation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EggProduction_farmId_idx" ON "EggProduction"("farmId");

-- CreateIndex
CREATE INDEX "EggProduction_farmId_date_idx" ON "EggProduction"("farmId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "EggProduction_batchId_date_key" ON "EggProduction"("batchId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Incubation_chickBatchId_key" ON "Incubation"("chickBatchId");

-- CreateIndex
CREATE INDEX "Incubation_farmId_idx" ON "Incubation"("farmId");

-- CreateIndex
CREATE INDEX "Incubation_sourceBatchId_idx" ON "Incubation"("sourceBatchId");

-- CreateIndex
CREATE UNIQUE INDEX "Incubation_farmId_code_key" ON "Incubation"("farmId", "code");

-- AddForeignKey
ALTER TABLE "EggProduction" ADD CONSTRAINT "EggProduction_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "Farm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EggProduction" ADD CONSTRAINT "EggProduction_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "AnimalBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incubation" ADD CONSTRAINT "Incubation_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "Farm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incubation" ADD CONSTRAINT "Incubation_sourceBatchId_fkey" FOREIGN KEY ("sourceBatchId") REFERENCES "AnimalBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incubation" ADD CONSTRAINT "Incubation_chickBatchId_fkey" FOREIGN KEY ("chickBatchId") REFERENCES "AnimalBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Business invariants the application also checks
ALTER TABLE "EggProduction" ADD CONSTRAINT "EggProduction_counts_nonnegative" CHECK ("collected" >= 0 AND "broken" >= 0 AND "downgraded" >= 0 AND "toIncubation" >= 0);
ALTER TABLE "EggProduction" ADD CONSTRAINT "EggProduction_outputs_within_collected" CHECK ("broken" + "downgraded" + "toIncubation" <= "collected");
ALTER TABLE "Incubation" ADD CONSTRAINT "Incubation_eggsSet_positive" CHECK ("eggsSet" > 0);
ALTER TABLE "Incubation" ADD CONSTRAINT "Incubation_fertileEggs_within_set" CHECK ("fertileEggs" IS NULL OR ("fertileEggs" >= 0 AND "fertileEggs" <= "eggsSet"));
ALTER TABLE "Incubation" ADD CONSTRAINT "Incubation_chicksHatched_nonnegative" CHECK ("chicksHatched" IS NULL OR "chicksHatched" >= 0);
