-- CreateTable
CREATE TABLE "CustomerPayment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "farmId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "kind" "CustomerPaymentKind" NOT NULL DEFAULT 'ENCAISSEMENT',
    "date" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "reference" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditNote" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "farmId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "withReturn" BOOLEAN NOT NULL,
    "total" DECIMAL(14,2) NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditNoteLine" (
    "id" TEXT NOT NULL,
    "creditNoteId" TEXT NOT NULL,
    "invoiceLineId" TEXT NOT NULL,
    "quantity" DECIMAL(12,2) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "CreditNoteLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomerPayment_farmId_idx" ON "CustomerPayment"("farmId");

-- CreateIndex
CREATE INDEX "CustomerPayment_invoiceId_idx" ON "CustomerPayment"("invoiceId");

-- CreateIndex
CREATE INDEX "CustomerPayment_createdById_idx" ON "CustomerPayment"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerPayment_organizationId_number_key" ON "CustomerPayment"("organizationId", "number");

-- CreateIndex
CREATE INDEX "CreditNote_farmId_idx" ON "CreditNote"("farmId");

-- CreateIndex
CREATE INDEX "CreditNote_invoiceId_idx" ON "CreditNote"("invoiceId");

-- CreateIndex
CREATE INDEX "CreditNote_createdById_idx" ON "CreditNote"("createdById");

-- CreateIndex
CREATE INDEX "CreditNote_farmId_date_idx" ON "CreditNote"("farmId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "CreditNote_organizationId_number_key" ON "CreditNote"("organizationId", "number");

-- CreateIndex
CREATE INDEX "CreditNoteLine_invoiceLineId_idx" ON "CreditNoteLine"("invoiceLineId");

-- CreateIndex
CREATE UNIQUE INDEX "CreditNoteLine_creditNoteId_invoiceLineId_key" ON "CreditNoteLine"("creditNoteId", "invoiceLineId");

-- AddForeignKey
ALTER TABLE "CustomerPayment" ADD CONSTRAINT "CustomerPayment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerPayment" ADD CONSTRAINT "CustomerPayment_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "Farm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerPayment" ADD CONSTRAINT "CustomerPayment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerPayment" ADD CONSTRAINT "CustomerPayment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "Farm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNoteLine" ADD CONSTRAINT "CreditNoteLine_creditNoteId_fkey" FOREIGN KEY ("creditNoteId") REFERENCES "CreditNote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNoteLine" ADD CONSTRAINT "CreditNoteLine_invoiceLineId_fkey" FOREIGN KEY ("invoiceLineId") REFERENCES "InvoiceLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Invariants the database holds whatever the service does.
ALTER TABLE "CustomerPayment" ADD CONSTRAINT "CustomerPayment_amount_check" CHECK ("amount" > 0);
ALTER TABLE "CustomerPayment" ADD CONSTRAINT "CustomerPayment_number_check" CHECK ("number" ~ '^RC-[0-9]{4,}$');
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_total_check" CHECK ("total" > 0);
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_number_check" CHECK ("number" ~ '^AV-[0-9]{4,}$');
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_reason_check" CHECK (btrim("reason") <> '');
ALTER TABLE "CreditNoteLine" ADD CONSTRAINT "CreditNoteLine_quantity_check" CHECK ("quantity" > 0);
ALTER TABLE "CreditNoteLine" ADD CONSTRAINT "CreditNoteLine_amount_check" CHECK ("amount" >= 0);
