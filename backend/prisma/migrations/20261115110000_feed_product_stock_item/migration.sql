-- A feed product may be drawn from one stock article (unique: an article feeds at most one product).
ALTER TABLE "FeedProduct" ADD COLUMN "stockItemId" TEXT;
CREATE UNIQUE INDEX "FeedProduct_stockItemId_key" ON "FeedProduct"("stockItemId");
ALTER TABLE "FeedProduct" ADD CONSTRAINT "FeedProduct_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "StockItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
