-- An egg line is sold by the tray (`PLATEAU`, eggs per tray snapshotted) or by the egg (`OEUF`, exactly 1 egg per unit).
ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_eggUnit_check" CHECK (
  "kind" <> 'OEUFS'
  OR ("unit" IS NOT NULL AND "unit" IN ('PLATEAU', 'OEUF') AND ("unit" <> 'OEUF' OR "eggsPerUnit" = 1))
);
