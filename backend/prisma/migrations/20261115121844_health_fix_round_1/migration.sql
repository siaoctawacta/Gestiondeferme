-- AlterTable
ALTER TABLE "HealthAct" ADD COLUMN     "enteredDone" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "HealthAct_farmId_status_idx" ON "HealthAct"("farmId", "status");

-- CreateIndex
CREATE INDEX "Quarantine_farmId_startDate_idx" ON "Quarantine"("farmId", "startDate");

-- An act entered as done has one date (its done day): best guess for rows that already exist.
UPDATE "HealthAct" SET "enteredDone" = true WHERE "status" = 'REALISE' AND "planId" IS NULL AND "date" = "doneDate";
ALTER TABLE "HealthAct" ADD CONSTRAINT "HealthAct_entered_check" CHECK (NOT "enteredDone" OR "status" <> 'PLANIFIE');

-- One open quarantine per lot and per animal (the services check first and answer 409).
CREATE UNIQUE INDEX "Quarantine_open_batch_key" ON "Quarantine"("batchId") WHERE "status" = 'EN_COURS' AND "batchId" IS NOT NULL;
CREATE UNIQUE INDEX "Quarantine_open_animal_key" ON "Quarantine"("animalId") WHERE "status" = 'EN_COURS' AND "animalId" IS NOT NULL;
