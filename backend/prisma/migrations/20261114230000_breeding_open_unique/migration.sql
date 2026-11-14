-- At most one open (gestating or nursing) breeding record per sow.
CREATE UNIQUE INDEX "BreedingRecord_sowId_open_key" ON "BreedingRecord"("sowId") WHERE "status" IN ('GESTATION', 'MISE_BAS');
