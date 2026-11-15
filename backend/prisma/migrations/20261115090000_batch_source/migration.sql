-- CreateEnum
CREATE TYPE "BatchSourceType" AS ENUM ('HATCH', 'FARROWING');

-- AlterTable
ALTER TABLE "AnimalBatch" ADD COLUMN "sourceId" TEXT,
ADD COLUMN "sourceType" "BatchSourceType";

-- Backfill: a chick batch is the one an incubation points at, a litter batch the one a breeding record points at.
UPDATE "AnimalBatch" b
SET "sourceType" = 'HATCH', "sourceId" = i."id"
FROM "Incubation" i
WHERE i."chickBatchId" = b."id";

UPDATE "AnimalBatch" b
SET "sourceType" = 'FARROWING', "sourceId" = r."id"
FROM "BreedingRecord" r
WHERE r."litterBatchId" = b."id" AND b."sourceType" IS NULL;

-- A batch with a sow but no record that points at it: still a litter (the sow stands in as source).
UPDATE "AnimalBatch"
SET "sourceType" = 'FARROWING', "sourceId" = "motherAnimalId"
WHERE "motherAnimalId" IS NOT NULL AND "sourceType" IS NULL;

-- Both or neither.
ALTER TABLE "AnimalBatch" ADD CONSTRAINT "AnimalBatch_source_check" CHECK (("sourceType" IS NULL) = ("sourceId" IS NULL));
