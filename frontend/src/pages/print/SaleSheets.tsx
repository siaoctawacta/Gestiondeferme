import { TD, TR } from '../../components/ui/Table';
import { formatDate, formatMoney } from '../../lib/format';
import { lineQuantityLabel } from '../../modules/saleLines';
import { methodLabel } from '../../modules/purchasingShared';
import type { CreditNoteData, InvoiceData, InvoicePayment, QuoteData } from '../../modules/salesShared';
import { SheetFrame, SheetTable, SheetTotal, type Legal } from './SheetFrame';

/**
 * The printed sales documents. Every amount and total is the API's (a line's stored `amount`, the document's `total`),
 * never recomputed here; there is no tax line. All of them sit in the `SheetFrame` of the bon de commande.
 */
interface SheetProps {
  farmName: string | undefined;
  legal: Legal | undefined;
}

/** The devis: the validity beside the references. */
export function QuoteSheet({ data, farmName, legal }: SheetProps & { data: QuoteData }) {
  return (
    <SheetFrame
      label="Devis"
      meta={
        <>
          <p>Référence : {data.reference}</p>
          <p>Date : {formatDate(data.date)}</p>
          {data.validUntil && <p>Valable jusqu'au {formatDate(data.validUntil)}</p>}
        </>
      }
      partyLabel="Client"
      party={{ name: data.customerName, address: data.customerAddress, phone: data.customerPhone }}
      farmName={farmName}
      legal={legal}
    >
      <SheetTable labels={['DÉSIGNATION', 'QUANTITÉ', 'PRIX UNITAIRE', 'MONTANT']}>
        {data.lines.map((l) => (
          <TR key={l.position}>
            <TD>{l.designation}</TD>
            <TD>{lineQuantityLabel(l)}</TD>
            <TD>{formatMoney(l.unitPrice)}</TD>
            <TD>{formatMoney(l.amount)}</TD>
          </TR>
        ))}
      </SheetTable>
      <SheetTotal total={data.total} />
    </SheetFrame>
  );
}

/** The facture: number, date and due date. */
export function InvoiceSheet({ data, farmName, legal }: SheetProps & { data: InvoiceData }) {
  return (
    <SheetFrame
      label="Facture"
      meta={
        <>
          <p>Référence : {data.number}</p>
          <p>Date : {formatDate(data.date)}</p>
          {data.dueDate && <p>Échéance : {formatDate(data.dueDate)}</p>}
        </>
      }
      partyLabel="Client"
      party={{ name: data.customerName, address: data.customerAddress, phone: data.customerPhone }}
      farmName={farmName}
      legal={legal}
    >
      <SheetTable labels={['DÉSIGNATION', 'QUANTITÉ', 'PRIX UNITAIRE', 'MONTANT']}>
        {data.lines.map((l) => (
          <TR key={l.position}>
            <TD>{l.designation}</TD>
            <TD>{lineQuantityLabel(l)}</TD>
            <TD>{formatMoney(l.unitPrice)}</TD>
            <TD>{formatMoney(l.amount)}</TD>
          </TR>
        ))}
      </SheetTable>
      <SheetTotal total={data.total} />
    </SheetFrame>
  );
}

/** The bon de livraison: what leaves the farm, quantities only. */
export function DeliveryNoteSheet({ data, farmName, legal }: SheetProps & { data: InvoiceData }) {
  return (
    <SheetFrame
      label="Bon de livraison"
      meta={
        <>
          <p>Facture : {data.number}</p>
          <p>Date : {formatDate(data.date)}</p>
        </>
      }
      partyLabel="Client"
      party={{ name: data.customerName, address: data.customerAddress, phone: data.customerPhone }}
      farmName={farmName}
      legal={legal}
    >
      <SheetTable labels={['DÉSIGNATION', 'QUANTITÉ']}>
        {data.lines.map((l) => (
          <TR key={l.position}>
            <TD>{l.designation}</TD>
            <TD>{lineQuantityLabel(l)}</TD>
          </TR>
        ))}
      </SheetTable>
      <p className="pt-8">Reçu par : ______________________</p>
    </SheetFrame>
  );
}

/** The avoir: the invoice it corrects, the reason, the credited lines and the credit total. */
export function CreditNoteSheet({ data, farmName, legal }: SheetProps & { data: CreditNoteData }) {
  return (
    <SheetFrame
      label="Avoir"
      meta={
        <>
          <p>Référence : {data.number}</p>
          <p>Date : {formatDate(data.date)}</p>
          <p>Facture : {data.invoiceNumber}</p>
        </>
      }
      partyLabel="Client"
      party={{ name: data.customerName, address: data.customerAddress, phone: data.customerPhone }}
      farmName={farmName}
      legal={legal}
    >
      <p>Motif : {data.reason}</p>
      <SheetTable labels={['DÉSIGNATION', 'QUANTITÉ', 'PRIX UNITAIRE', 'MONTANT']}>
        {data.lines.map((l) => (
          <TR key={l.id}>
            <TD>{l.designation}</TD>
            <TD>{lineQuantityLabel(l)}</TD>
            <TD>{formatMoney(l.unitPrice)}</TD>
            <TD>{formatMoney(l.amount)}</TD>
          </TR>
        ))}
      </SheetTable>
      <SheetTotal total={data.total} />
    </SheetFrame>
  );
}

/** The reçu of one payment (or refund) of an invoice. */
export function ReceiptSheet({ invoice, payment, farmName, legal }: SheetProps & { invoice: InvoiceData; payment: InvoicePayment }) {
  return (
    <SheetFrame
      label="Reçu"
      meta={
        <>
          <p>Référence : {payment.number}</p>
          <p>Date : {formatDate(payment.date)}</p>
          <p>Facture : {invoice.number}</p>
        </>
      }
      partyLabel="Client"
      party={{ name: invoice.customerName, address: invoice.customerAddress, phone: invoice.customerPhone }}
      farmName={farmName}
      legal={legal}
    >
      <div className="space-y-1">
        <p className="text-base font-bold">{payment.kind === 'REMBOURSEMENT' ? 'Montant remboursé' : 'Montant reçu'} : {formatMoney(payment.amount)}</p>
        <p>Mode de paiement : {methodLabel(payment.method)}</p>
        {payment.reference && <p>Référence du paiement : {payment.reference}</p>}
      </div>
    </SheetFrame>
  );
}
