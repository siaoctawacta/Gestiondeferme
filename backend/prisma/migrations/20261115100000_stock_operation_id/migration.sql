-- The pieces of one operation (an exit split across lots) share an operation id; existing rows are their own operation.
ALTER TABLE "StockMovement" ADD COLUMN "operationId" TEXT;
UPDATE "StockMovement" SET "operationId" = "id";
ALTER TABLE "StockMovement" ALTER COLUMN "operationId" SET NOT NULL;
CREATE INDEX "StockMovement_operationId_idx" ON "StockMovement"("operationId");
