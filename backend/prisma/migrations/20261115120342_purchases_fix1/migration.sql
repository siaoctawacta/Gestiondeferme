-- CreateTable
CREATE TABLE "PurchaseCounter" (
    "organizationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "last" INTEGER NOT NULL,

    CONSTRAINT "PurchaseCounter_pkey" PRIMARY KEY ("organizationId","kind")
);

-- CreateIndex
CREATE INDEX "Purchase_farmId_date_idx" ON "Purchase"("farmId", "date");

-- AddForeignKey
ALTER TABLE "PurchaseCounter" ADD CONSTRAINT "PurchaseCounter_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A reception never exceeds the ordered quantity (a surplus is a separate stock entry).
ALTER TABLE "PurchaseItem" ADD CONSTRAINT "PurchaseItem_received_le_quantity_check" CHECK ("receivedQuantity" IS NULL OR "receivedQuantity" <= "quantity");
ALTER TABLE "PurchaseCounter" ADD CONSTRAINT "PurchaseCounter_kind_check" CHECK ("kind" IN ('DA', 'BC'));
ALTER TABLE "PurchaseCounter" ADD CONSTRAINT "PurchaseCounter_last_check" CHECK ("last" >= 1);
