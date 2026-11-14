-- DropForeignKey
ALTER TABLE "FeedDistribution" DROP CONSTRAINT "FeedDistribution_batchId_fkey";

-- DropForeignKey
ALTER TABLE "FeedDistribution" DROP CONSTRAINT "FeedDistribution_buildingId_fkey";

-- DropForeignKey
ALTER TABLE "WaterConsumption" DROP CONSTRAINT "WaterConsumption_batchId_fkey";

-- DropForeignKey
ALTER TABLE "WaterConsumption" DROP CONSTRAINT "WaterConsumption_buildingId_fkey";

-- AddForeignKey
ALTER TABLE "FeedDistribution" ADD CONSTRAINT "FeedDistribution_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "AnimalBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedDistribution" ADD CONSTRAINT "FeedDistribution_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaterConsumption" ADD CONSTRAINT "WaterConsumption_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "AnimalBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaterConsumption" ADD CONSTRAINT "WaterConsumption_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Invariants the services also enforce (with French messages); the database is the last line.
ALTER TABLE "FeedProduct" ADD CONSTRAINT "FeedProduct_unitCost_check" CHECK ("unitCost" >= 0);
ALTER TABLE "FeedFormulaItem" ADD CONSTRAINT "FeedFormulaItem_percentage_check" CHECK ("percentage" > 0);
ALTER TABLE "FeedDistribution" ADD CONSTRAINT "FeedDistribution_target_check" CHECK (("batchId" IS NULL) <> ("buildingId" IS NULL));
ALTER TABLE "FeedDistribution" ADD CONSTRAINT "FeedDistribution_feed_check" CHECK (("feedProductId" IS NULL) <> ("formulaId" IS NULL));
ALTER TABLE "FeedDistribution" ADD CONSTRAINT "FeedDistribution_quantityKg_check" CHECK ("quantityKg" > 0);
ALTER TABLE "FeedDistribution" ADD CONSTRAINT "FeedDistribution_unitCost_check" CHECK ("unitCost" >= 0);
ALTER TABLE "FeedDistribution" ADD CONSTRAINT "FeedDistribution_cost_check" CHECK ("cost" >= 0);
ALTER TABLE "WaterConsumption" ADD CONSTRAINT "WaterConsumption_target_check" CHECK (("batchId" IS NULL) <> ("buildingId" IS NULL));
ALTER TABLE "WaterConsumption" ADD CONSTRAINT "WaterConsumption_liters_check" CHECK ("liters" > 0);
