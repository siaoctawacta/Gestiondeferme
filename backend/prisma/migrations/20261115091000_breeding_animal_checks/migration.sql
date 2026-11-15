-- Validate the existing rows first, so a failure names the problem instead of a bare constraint error.
DO $$
DECLARE
  bad_records integer;
  bad_animals integer;
BEGIN
  SELECT count(*) INTO bad_records FROM "BreedingRecord"
  WHERE "bornTotal" < 0 OR "bornAlive" < 0 OR "stillborn" < 0 OR "weanedCount" < 0
     OR ("bornAlive" + "stillborn") > "bornTotal";
  IF bad_records > 0 THEN
    RAISE EXCEPTION '% breeding record(s) have negative counts or more born alive + stillborn than born total; fix them before applying this migration', bad_records;
  END IF;

  SELECT count(*) INTO bad_animals FROM "Animal"
  WHERE NOT (("category" = 'VERRAT' AND "sex" = 'M') OR ("category" IN ('TRUIE', 'COCHETTE') AND "sex" = 'F'));
  IF bad_animals > 0 THEN
    RAISE EXCEPTION '% animal(s) have a sex that does not match their category; fix them before applying this migration', bad_animals;
  END IF;
END $$;

-- Invariants the services also enforce (with French messages); the database is the last line.
ALTER TABLE "BreedingRecord" ADD CONSTRAINT "BreedingRecord_bornTotal_check" CHECK ("bornTotal" >= 0);
ALTER TABLE "BreedingRecord" ADD CONSTRAINT "BreedingRecord_bornAlive_check" CHECK ("bornAlive" >= 0);
ALTER TABLE "BreedingRecord" ADD CONSTRAINT "BreedingRecord_stillborn_check" CHECK ("stillborn" >= 0);
ALTER TABLE "BreedingRecord" ADD CONSTRAINT "BreedingRecord_weanedCount_check" CHECK ("weanedCount" >= 0);
ALTER TABLE "BreedingRecord" ADD CONSTRAINT "BreedingRecord_litter_check" CHECK ("bornAlive" + "stillborn" <= "bornTotal");
ALTER TABLE "Animal" ADD CONSTRAINT "Animal_sex_category_check" CHECK (("category" = 'VERRAT' AND "sex" = 'M') OR ("category" IN ('TRUIE', 'COCHETTE') AND "sex" = 'F'));
