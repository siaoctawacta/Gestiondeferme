-- The part of a distribution's cost that the stock ledger does not value (unlinked
-- ingredients at catalogue price). With it, the current cost of a distribution is
-- the sum of its ledger exits + this part; `cost` and `unitCost` stay the snapshot.
ALTER TABLE "FeedDistribution" ADD COLUMN "unlinkedCost" DECIMAL(16,4) NOT NULL DEFAULT 0;

-- Backfill, for a distribution that has ledger exits: a feed that is a product
-- linked to stock has no unlinked part; for a formula it is what the snapshot
-- holds beyond the exits (their per-operation rounded cost). A distribution with
-- no exit keeps 0 and shows its snapshot.
UPDATE "FeedDistribution" d
SET "unlinkedCost" = GREATEST(
  d."cost" - (
    SELECT COALESCE(SUM(op."cost"), 0) FROM (
      SELECT ROUND(SUM(ABS(m."quantity") * m."unitCost"), 2) AS "cost"
      FROM "StockMovement" m
      WHERE m."sourceType" = 'FEED_DISTRIBUTION' AND m."sourceId" = d."id"
      GROUP BY m."operationId"
    ) op
  ),
  0
)
WHERE d."formulaId" IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "StockMovement" m
    WHERE m."sourceType" = 'FEED_DISTRIBUTION' AND m."sourceId" = d."id"
  );
