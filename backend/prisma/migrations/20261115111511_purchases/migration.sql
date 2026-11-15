-- CreateEnum
CREATE TYPE "PurchaseStatus" AS ENUM ('DEMANDE', 'VALIDEE', 'COMMANDEE', 'RECUE', 'PAYEE', 'ANNULEE');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('ESPECES', 'VIREMENT', 'MOBILE_MONEY', 'CHEQUE');

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "products" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Purchase" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "farmId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "orderNumber" TEXT,
    "date" DATE NOT NULL,
    "status" "PurchaseStatus" NOT NULL DEFAULT 'DEMANDE',
    "requestedById" TEXT NOT NULL,
    "validatedById" TEXT,
    "validatedAt" TIMESTAMP(3),
    "orderedById" TEXT,
    "orderedAt" TIMESTAMP(3),
    "receivedById" TEXT,
    "receivedAt" TIMESTAMP(3),
    "receivedDate" DATE,
    "cancelledById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Purchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseItem" (
    "id" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "stockItemId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "quantity" DECIMAL(12,2) NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "receivedQuantity" DECIMAL(12,2),
    "lotNumber" TEXT,
    "expiryDate" DATE,

    CONSTRAINT "PurchaseItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierPayment" (
    "id" TEXT NOT NULL,
    "farmId" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "reference" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_organizationId_name_key" ON "Supplier"("organizationId", "name");

-- CreateIndex
CREATE INDEX "Purchase_farmId_idx" ON "Purchase"("farmId");

-- CreateIndex
CREATE INDEX "Purchase_supplierId_idx" ON "Purchase"("supplierId");

-- CreateIndex
CREATE INDEX "Purchase_requestedById_idx" ON "Purchase"("requestedById");

-- CreateIndex
CREATE INDEX "Purchase_validatedById_idx" ON "Purchase"("validatedById");

-- CreateIndex
CREATE INDEX "Purchase_orderedById_idx" ON "Purchase"("orderedById");

-- CreateIndex
CREATE INDEX "Purchase_receivedById_idx" ON "Purchase"("receivedById");

-- CreateIndex
CREATE INDEX "Purchase_cancelledById_idx" ON "Purchase"("cancelledById");

-- CreateIndex
CREATE INDEX "Purchase_farmId_status_idx" ON "Purchase"("farmId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Purchase_organizationId_reference_key" ON "Purchase"("organizationId", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "Purchase_organizationId_orderNumber_key" ON "Purchase"("organizationId", "orderNumber");

-- CreateIndex
CREATE INDEX "PurchaseItem_stockItemId_idx" ON "PurchaseItem"("stockItemId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseItem_purchaseId_position_key" ON "PurchaseItem"("purchaseId", "position");

-- CreateIndex
CREATE INDEX "SupplierPayment_farmId_idx" ON "SupplierPayment"("farmId");

-- CreateIndex
CREATE INDEX "SupplierPayment_purchaseId_idx" ON "SupplierPayment"("purchaseId");

-- CreateIndex
CREATE INDEX "SupplierPayment_createdById_idx" ON "SupplierPayment"("createdById");

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "Farm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_validatedById_fkey" FOREIGN KEY ("validatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_orderedById_fkey" FOREIGN KEY ("orderedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseItem" ADD CONSTRAINT "PurchaseItem_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseItem" ADD CONSTRAINT "PurchaseItem_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "StockItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "Farm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Numeric and text invariants.
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_reference_check" CHECK ("reference" ~ '^DA-[0-9]+$');
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_orderNumber_check" CHECK ("orderNumber" IS NULL OR "orderNumber" ~ '^BC-[0-9]+$');
ALTER TABLE "PurchaseItem" ADD CONSTRAINT "PurchaseItem_quantity_check" CHECK ("quantity" > 0);
ALTER TABLE "PurchaseItem" ADD CONSTRAINT "PurchaseItem_unitPrice_check" CHECK ("unitPrice" >= 0);
ALTER TABLE "PurchaseItem" ADD CONSTRAINT "PurchaseItem_receivedQuantity_check" CHECK ("receivedQuantity" IS NULL OR "receivedQuantity" >= 0);
ALTER TABLE "PurchaseItem" ADD CONSTRAINT "PurchaseItem_position_check" CHECK ("position" >= 0);
-- A lot only exists for a line actually received.
ALTER TABLE "PurchaseItem" ADD CONSTRAINT "PurchaseItem_lot_check" CHECK (
  ("lotNumber" IS NULL AND "expiryDate" IS NULL) OR COALESCE("receivedQuantity", 0) > 0
);
ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_amount_check" CHECK ("amount" > 0);

-- Timestamps and their authors go together.
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_validated_check" CHECK (("validatedAt" IS NULL) = ("validatedById" IS NULL));
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_ordered_check" CHECK (
  ("orderedAt" IS NULL) = ("orderedById" IS NULL) AND ("orderedAt" IS NULL) = ("orderNumber" IS NULL)
);
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_received_check" CHECK (
  ("receivedAt" IS NULL) = ("receivedById" IS NULL) AND ("receivedAt" IS NULL) = ("receivedDate" IS NULL)
);
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_cancelled_check" CHECK (
  ("cancelledAt" IS NULL) = ("cancelledById" IS NULL) AND ("cancelledAt" IS NULL) = ("cancelReason" IS NULL)
);

-- The status says exactly which steps have been taken.
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_status_check" CHECK (
  CASE "status"
    WHEN 'DEMANDE' THEN "validatedAt" IS NULL AND "orderedAt" IS NULL AND "receivedAt" IS NULL AND "cancelledAt" IS NULL
    WHEN 'VALIDEE' THEN "validatedAt" IS NOT NULL AND "orderedAt" IS NULL AND "receivedAt" IS NULL AND "cancelledAt" IS NULL
    WHEN 'COMMANDEE' THEN "validatedAt" IS NOT NULL AND "orderedAt" IS NOT NULL AND "receivedAt" IS NULL AND "cancelledAt" IS NULL
    WHEN 'RECUE' THEN "validatedAt" IS NOT NULL AND "orderedAt" IS NOT NULL AND "receivedAt" IS NOT NULL AND "cancelledAt" IS NULL
    WHEN 'PAYEE' THEN "validatedAt" IS NOT NULL AND "orderedAt" IS NOT NULL AND "receivedAt" IS NOT NULL AND "cancelledAt" IS NULL
    WHEN 'ANNULEE' THEN "cancelledAt" IS NOT NULL AND "receivedAt" IS NULL AND ("orderedAt" IS NULL OR "validatedAt" IS NOT NULL)
  END
);
