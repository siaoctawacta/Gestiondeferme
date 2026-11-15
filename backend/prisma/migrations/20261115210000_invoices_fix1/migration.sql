-- The ledger is the single truth of what a sale's stock exit cost: no snapshot on the line.
ALTER TABLE "InvoiceLine" DROP CONSTRAINT "InvoiceLine_exitUnitCost_check";
ALTER TABLE "InvoiceLine" DROP COLUMN "exitUnitCost";

-- One link between a quote and its invoice: `Invoice.quoteId` (unique).
ALTER TABLE "Quote" DROP CONSTRAINT "Quote_invoiceId_fkey";
DROP INDEX "Quote_invoiceId_key";
ALTER TABLE "Quote" DROP COLUMN "invoiceId";

-- The status and the timestamps of an invoice tell the same story.
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_issued_check" CHECK (
  ("status" <> 'BROUILLON') = ("issuedAt" IS NOT NULL AND "issuedById" IS NOT NULL)
  AND ("issuedAt" IS NULL) = ("issuedById" IS NULL)
);
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_cancelled_check" CHECK (
  ("status" = 'ANNULEE') = ("cancelledAt" IS NOT NULL AND "cancelledById" IS NOT NULL AND "cancelReason" IS NOT NULL)
  AND ("cancelledAt" IS NULL) = ("cancelledById" IS NULL)
  AND ("cancelledAt" IS NULL) = ("cancelReason" IS NULL)
);
