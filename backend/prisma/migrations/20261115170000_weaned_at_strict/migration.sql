-- A weaning is recorded strictly after the events of its litter written with it
-- (the write-off shared its millisecond): push such weanings 1 ms later.
UPDATE "BreedingRecord" r SET "weanedAt" = r."weanedAt" + interval '1 millisecond'
WHERE r."status" = 'SEVRAGE' AND r."litterBatchId" IS NOT NULL
  AND EXISTS (SELECT 1 FROM "BatchEvent" e WHERE e."batchId" = r."litterBatchId" AND e."createdAt" = r."weanedAt");
-- A weaned record is complete.
UPDATE "BreedingRecord" SET "weanedAt" = "updatedAt" WHERE "status" = 'SEVRAGE' AND "weanedAt" IS NULL;
ALTER TABLE "BreedingRecord" ADD CONSTRAINT "BreedingRecord_weaned_check"
  CHECK ("status" <> 'SEVRAGE' OR ("weanedAt" IS NOT NULL AND "weaningDate" IS NOT NULL AND "weanedCount" IS NOT NULL));
