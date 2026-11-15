-- The moment a weaning was recorded (its position in the day for the herd ledger).
ALTER TABLE "BreedingRecord" ADD COLUMN "weanedAt" TIMESTAMP(3);
UPDATE "BreedingRecord" SET "weanedAt" = "updatedAt" WHERE "status" = 'SEVRAGE';
