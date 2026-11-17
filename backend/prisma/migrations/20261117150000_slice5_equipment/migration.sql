-- CreateEnum
CREATE TYPE "EquipmentType" AS ENUM ('COUVEUSE', 'BALANCE', 'POMPE', 'GROUPE_ELECTROGENE', 'VENTILATEUR', 'CHAUFFAGE', 'ABREUVOIR', 'MANGEOIRE', 'VEHICULE', 'AUTRE');

-- CreateEnum
CREATE TYPE "EquipmentCondition" AS ENUM ('BON', 'A_SURVEILLER', 'EN_PANNE');

-- CreateEnum
CREATE TYPE "MaintenanceKind" AS ENUM ('PREVENTIVE', 'CORRECTIVE');

-- CreateTable
CREATE TABLE "Equipment" (
    "id" TEXT NOT NULL,
    "farmId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "EquipmentType" NOT NULL,
    "siteId" TEXT,
    "buildingId" TEXT,
    "brand" TEXT,
    "serialNumber" TEXT,
    "purchaseDate" DATE,
    "maintenanceIntervalDays" INTEGER,
    "firstMaintenanceDate" DATE,
    "nextMaintenanceDate" DATE,
    "condition" "EquipmentCondition" NOT NULL DEFAULT 'BON',
    "retiredAt" DATE,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Maintenance" (
    "id" TEXT NOT NULL,
    "farmId" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "kind" "MaintenanceKind" NOT NULL,
    "date" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "performedBy" TEXT,
    "supplierId" TEXT,
    "cost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "nextDate" DATE,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Maintenance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Breakdown" (
    "id" TEXT NOT NULL,
    "farmId" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "reportedById" TEXT NOT NULL,
    "repairId" TEXT,
    "resolvedDate" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Breakdown_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Equipment_farmId_condition_idx" ON "Equipment"("farmId", "condition");

-- CreateIndex
CREATE INDEX "Equipment_farmId_nextMaintenanceDate_idx" ON "Equipment"("farmId", "nextMaintenanceDate");

-- CreateIndex
CREATE INDEX "Equipment_siteId_idx" ON "Equipment"("siteId");

-- CreateIndex
CREATE INDEX "Equipment_buildingId_idx" ON "Equipment"("buildingId");

-- CreateIndex
CREATE UNIQUE INDEX "Equipment_farmId_name_key" ON "Equipment"("farmId", "name");

-- CreateIndex
CREATE INDEX "Maintenance_farmId_idx" ON "Maintenance"("farmId");

-- CreateIndex
CREATE INDEX "Maintenance_equipmentId_date_idx" ON "Maintenance"("equipmentId", "date");

-- CreateIndex
CREATE INDEX "Maintenance_supplierId_idx" ON "Maintenance"("supplierId");

-- CreateIndex
CREATE INDEX "Maintenance_createdById_idx" ON "Maintenance"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "Breakdown_repairId_key" ON "Breakdown"("repairId");

-- CreateIndex
CREATE INDEX "Breakdown_farmId_idx" ON "Breakdown"("farmId");

-- CreateIndex
CREATE INDEX "Breakdown_equipmentId_idx" ON "Breakdown"("equipmentId");

-- CreateIndex
CREATE INDEX "Breakdown_reportedById_idx" ON "Breakdown"("reportedById");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Equipment" ADD CONSTRAINT "Equipment_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "Farm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Equipment" ADD CONSTRAINT "Equipment_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Equipment" ADD CONSTRAINT "Equipment_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Maintenance" ADD CONSTRAINT "Maintenance_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "Farm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Maintenance" ADD CONSTRAINT "Maintenance_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Maintenance" ADD CONSTRAINT "Maintenance_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Maintenance" ADD CONSTRAINT "Maintenance_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Breakdown" ADD CONSTRAINT "Breakdown_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "Farm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Breakdown" ADD CONSTRAINT "Breakdown_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Breakdown" ADD CONSTRAINT "Breakdown_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Breakdown" ADD CONSTRAINT "Breakdown_repairId_fkey" FOREIGN KEY ("repairId") REFERENCES "Maintenance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Invariants
ALTER TABLE "Equipment" ADD CONSTRAINT "Equipment_name_check" CHECK (btrim("name") <> '');
ALTER TABLE "Equipment" ADD CONSTRAINT "Equipment_location_check" CHECK ("siteId" IS NULL OR "buildingId" IS NULL);
ALTER TABLE "Equipment" ADD CONSTRAINT "Equipment_interval_check" CHECK ("maintenanceIntervalDays" IS NULL OR "maintenanceIntervalDays" > 0);
ALTER TABLE "Maintenance" ADD CONSTRAINT "Maintenance_cost_check" CHECK ("cost" >= 0);
ALTER TABLE "Maintenance" ADD CONSTRAINT "Maintenance_next_check" CHECK ("nextDate" IS NULL OR "nextDate" > "date");
ALTER TABLE "Maintenance" ADD CONSTRAINT "Maintenance_description_check" CHECK (btrim("description") <> '');
ALTER TABLE "Breakdown" ADD CONSTRAINT "Breakdown_resolved_check" CHECK (("repairId" IS NULL) = ("resolvedDate" IS NULL));
ALTER TABLE "Breakdown" ADD CONSTRAINT "Breakdown_resolved_date_check" CHECK ("resolvedDate" IS NULL OR "resolvedDate" >= "date");
ALTER TABLE "Breakdown" ADD CONSTRAINT "Breakdown_description_check" CHECK (btrim("description") <> '');

-- One open breakdown per equipment.
CREATE UNIQUE INDEX "Breakdown_open_equipment_key" ON "Breakdown"("equipmentId") WHERE "resolvedDate" IS NULL;

-- The finance ledger gains a sixth origin (only a branch is added, no column changes, so the view is replaced in place):
--   MAINTENANCE  an intervention with a cost, an expense of category Entretien at the intervention date; the activity
--                follows the type of the equipment's building (otherwise general). Never a lot cost.
CREATE OR REPLACE VIEW "FinanceLedgerView" AS
  SELECT e."id", e."farmId", e."date", e."kind", e."label", e."activity", e."category", e."amount",
         'MANUEL'::text AS "origin", NULL::text AS "sourceId", e."batchId", e."note"
  FROM "FinanceEntry" e
UNION ALL
  SELECT 'achat:' || p."id" || ':' || i."expenseCategory"::text, p."farmId", p."receivedDate",
         'DEPENSE'::"FinanceKind",
         'Achat ' || COALESCE(p."orderNumber", p."reference") || ' — ' || s."name",
         p."activity", i."expenseCategory", SUM(i."amount"),
         'ACHAT'::text, p."id", NULL::text, NULL::text
  FROM "Purchase" p
  JOIN "PurchaseItem" i ON i."purchaseId" = p."id"
  JOIN "Supplier" s ON s."id" = p."supplierId"
  WHERE p."status" IN ('RECUE', 'PAYEE') AND p."receivedDate" IS NOT NULL AND i."expenseCategory" IS NOT NULL
  GROUP BY p."id", p."farmId", p."receivedDate", p."orderNumber", p."reference", s."name", p."activity", i."expenseCategory"
  HAVING SUM(i."amount") > 0
UNION ALL
  SELECT 'lot:' || b."id", b."farmId", b."entryDate", 'DEPENSE'::"FinanceKind",
         'Achat du lot ' || b."code",
         (CASE b."species" WHEN 'AVICOLE' THEN 'AVICOLE' WHEN 'PORCIN' THEN 'PORCIN' END)::"Activity",
         'ANIMAUX'::"FinanceCategory", b."purchasePrice",
         'LOT'::text, b."id", b."id", NULL::text
  FROM "AnimalBatch" b
  WHERE b."purchasePrice" > 0
UNION ALL
  SELECT 'facture:' || inv."id" || ':' || l."activity"::text || ':' || l."revenueCategory"::text, inv."farmId", inv."date",
         'RECETTE'::"FinanceKind",
         'Facture ' || inv."number" || ' — ' || c."name",
         l."activity", l."revenueCategory", SUM(l."amount"),
         'FACTURE'::text, inv."id", NULL::text, NULL::text
  FROM "Invoice" inv
  JOIN "InvoiceLine" l ON l."invoiceId" = inv."id"
  JOIN "Customer" c ON c."id" = inv."customerId"
  WHERE inv."status" IN ('EMISE', 'PARTIELLE', 'SOLDEE')
  GROUP BY inv."id", inv."farmId", inv."date", inv."number", c."name", l."activity", l."revenueCategory"
  HAVING SUM(l."amount") <> 0
UNION ALL
  SELECT 'avoir:' || cn."id" || ':' || il."activity"::text || ':' || il."revenueCategory"::text, cn."farmId", cn."date",
         'RECETTE'::"FinanceKind",
         'Avoir ' || cn."number" || ' — ' || c."name" || ' (' || inv."number" || ')',
         il."activity", il."revenueCategory", -SUM(cl."amount"),
         'AVOIR'::text, NULL::text, NULL::text, NULL::text
  FROM "CreditNote" cn
  JOIN "CreditNoteLine" cl ON cl."creditNoteId" = cn."id"
  JOIN "InvoiceLine" il ON il."id" = cl."invoiceLineId"
  JOIN "Invoice" inv ON inv."id" = cn."invoiceId"
  JOIN "Customer" c ON c."id" = inv."customerId"
  WHERE inv."status" IN ('EMISE', 'PARTIELLE', 'SOLDEE')
  GROUP BY cn."id", cn."farmId", cn."date", cn."number", c."name", inv."number", il."activity", il."revenueCategory"
  HAVING SUM(cl."amount") <> 0
UNION ALL
  SELECT 'maintenance:' || m."id", m."farmId", m."date", 'DEPENSE'::"FinanceKind",
         'Maintenance ' || q."name" || ' — ' || m."description",
         (CASE bd."type" WHEN 'AVICOLE' THEN 'AVICOLE' WHEN 'PORCIN' THEN 'PORCIN' ELSE 'GENERAL' END)::"Activity",
         'ENTRETIEN'::"FinanceCategory", m."cost",
         'MAINTENANCE'::text, m."id", NULL::text, NULL::text
  FROM "Maintenance" m
  JOIN "Equipment" q ON q."id" = m."equipmentId"
  LEFT JOIN "Building" bd ON bd."id" = q."buildingId"
  WHERE m."cost" > 0;
