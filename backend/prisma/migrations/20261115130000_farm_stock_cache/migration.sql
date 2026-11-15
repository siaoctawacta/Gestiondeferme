-- Cache of the ledger replay on the per-(farm, article) lock row.
ALTER TABLE "FarmStockItem" ADD COLUMN "quantity" DECIMAL(14,2) NOT NULL DEFAULT 0;
ALTER TABLE "FarmStockItem" ADD COLUMN "averageCost" DECIMAL(40,20);

-- The quantity is a plain sum.
UPDATE "FarmStockItem" f
SET "quantity" = s."total"
FROM (
  SELECT "farmId", "stockItemId", SUM("quantity") AS "total"
  FROM "StockMovement"
  GROUP BY "farmId", "stockItemId"
) s
WHERE s."farmId" = f."farmId" AND s."stockItemId" = f."stockItemId";

-- The weighted-average cost needs the ordered replay (it depends on the running
-- quantity), which SQL cannot express simply: it stays NULL for every pair that
-- has movements. Such a pair is replayed by readers and persisted by the next
-- ledger write. A pair with no movement has an average of 0.
UPDATE "FarmStockItem" f
SET "averageCost" = 0
WHERE NOT EXISTS (
  SELECT 1 FROM "StockMovement" m
  WHERE m."farmId" = f."farmId" AND m."stockItemId" = f."stockItemId"
);
