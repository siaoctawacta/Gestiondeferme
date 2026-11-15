import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { FileText, Printer, Trash2, Truck } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatDate, formatMoney, formatNumber } from '../../lib/format';
import { farmKey, useFarmQuery } from '../../lib/query';
import { ConfirmDialog } from '../../components/module/ConfirmDialog';
import { ActionButton } from '../../components/module/DataTable';
import { ErrorRetry } from '../../components/module/ErrorRetry';
import { errorMessage } from '../../components/module/errorMessage';
import { canRunAction } from '../../components/module/rowActions';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Pill } from '../../components/ui/Pill';
import { Table, TD, TH, THead, TR } from '../../components/ui/Table';
import { CreditNotePrintDialog, INVOICE_ACTIONS, type InvoiceActionDef } from '../../modules/saleActions';
import { kindLabel, lineQuantityLabel } from '../../modules/saleLines';
import { methodLabel } from '../../modules/purchasingShared';
import {
  INVOICE_STEP_LABELS, invoiceStatusDef, type InvoiceCreditNote, type InvoiceData, type InvoicePayment,
} from '../../modules/salesShared';
import NotFound from '../NotFound';
import { DeliveryNoteSheet, InvoiceSheet, ReceiptSheet } from '../print/SaleSheets';
import { SheetHeads, useLegal } from '../print/SheetFrame';
import { DetailLayout } from './DetailLayout';

/** The sheet being printed: the invoice, its delivery note or the receipt of one payment. */
type Printing = { n: number; sheet: 'invoice' | 'delivery' } | { n: number; sheet: 'receipt'; payment: InvoicePayment };

/** Statuses from which the invoice exists as a document (number assigned, goods out): not a draft, not cancelled. */
const ISSUED = ['EMISE', 'PARTIELLE', 'SOLDEE'];

const Empty = ({ cols, text }: { cols: number; text: string }) => <TR><TD colSpan={cols} className="py-10 text-center text-muted-foreground">{text}</TD></TR>;

function LinesTab({ data }: { data: InvoiceData }) {
  return (
    <Card className="overflow-hidden">
      <Table>
        <SheetHeads labels={['TYPE', 'DÉSIGNATION', 'SOURCE', 'QUANTITÉ', 'PRIX UNITAIRE', 'TOTAL', 'CRÉDITÉ']} />
        <tbody>
          {data.lines.map((l) => (
            <TR key={l.id}>
              <TD>{kindLabel(l.kind)}</TD>
              <TD className="font-semibold">{l.designation}</TD>
              <TD>{l.sourceLabel ?? '—'}</TD>
              <TD>{lineQuantityLabel(l)}</TD>
              <TD>{formatMoney(l.unitPrice)}</TD>
              <TD>{formatMoney(l.amount)}</TD>
              <TD>{formatNumber(l.creditedQuantity)}</TD>
            </TR>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}

function PaymentsTab({ data, canDelete, onReceipt, onDelete }: {
  data: InvoiceData; canDelete: boolean; onReceipt: (p: InvoicePayment) => void; onDelete: (p: InvoicePayment) => void;
}) {
  return (
    <Card className="overflow-hidden">
      <Table>
        <THead>
          <TR className="border-b!">
            {['N° REÇU', 'DATE', 'MODE', 'MONTANT'].map((h) => <TH key={h}>{h}</TH>)}
            <TH><span className="sr-only">Actions</span></TH>
          </TR>
        </THead>
        <tbody>
          {data.payments.length === 0 && <Empty cols={5} text="Aucun paiement" />}
          {data.payments.map((p) => (
            <TR key={p.id}>
              <TD className="font-semibold">{p.number}</TD>
              <TD>{formatDate(p.date)}</TD>
              <TD>{p.kind === 'REMBOURSEMENT' ? `Remboursement — ${methodLabel(p.method)}` : methodLabel(p.method)}</TD>
              <TD>{formatMoney(p.amount)}</TD>
              <TD>
                <div className="flex min-h-8 items-center justify-end gap-1">
                  <ActionButton label="Reçu" onClick={() => onReceipt(p)}><Printer aria-hidden className="size-4" /></ActionButton>
                  {canDelete && <ActionButton label="Supprimer" onClick={() => onDelete(p)}><Trash2 aria-hidden className="size-4" /></ActionButton>}
                </div>
              </TD>
            </TR>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}

function CreditNotesTab({ data, onPrint }: { data: InvoiceData; onPrint: (c: InvoiceCreditNote) => void }) {
  return (
    <Card className="overflow-hidden">
      <Table>
        <THead>
          <TR className="border-b!">
            {['DATE', 'N° AVOIR', 'MOTIF', 'RETOUR', 'MONTANT'].map((h) => <TH key={h}>{h}</TH>)}
            <TH><span className="sr-only">Actions</span></TH>
          </TR>
        </THead>
        <tbody>
          {data.creditNotes.length === 0 && <Empty cols={6} text="Aucun avoir" />}
          {data.creditNotes.map((c) => (
            <TR key={c.id}>
              <TD>{formatDate(c.date)}</TD>
              <TD className="font-semibold">{c.number}</TD>
              <TD>{c.reason}</TD>
              <TD>{c.withReturn ? 'Oui' : 'Non'}</TD>
              <TD>{formatMoney(c.total)}</TD>
              <TD>
                <div className="flex min-h-8 items-center justify-end">
                  <ActionButton label="Imprimer" onClick={() => onPrint(c)}><Printer aria-hidden className="size-4" /></ActionButton>
                </div>
              </TD>
            </TR>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}

function HistoryTab({ data }: { data: InvoiceData }) {
  return (
    <Card className="overflow-hidden">
      <Table>
        <SheetHeads labels={['ÉTAPE', 'DATE', 'PAR', 'NOTE']} />
        <tbody>
          {data.history.length === 0 && <Empty cols={4} text="Aucun enregistrement" />}
          {data.history.map((h, i) => (
            <TR key={`${i}-${h.step}`}>
              <TD className="font-semibold">{INVOICE_STEP_LABELS[h.step] ?? h.step}</TD>
              <TD>{formatDate(h.at)}</TD>
              <TD>{h.by ?? '—'}</TD>
              <TD>{h.note ?? ''}</TD>
            </TR>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}

function Loaded({ data }: { data: InvoiceData }) {
  const { can, farmId, farms } = useAuth();
  const queryClient = useQueryClient();
  const [acting, setActing] = useState<InvoiceActionDef | null>(null);
  const [deleting, setDeleting] = useState<InvoicePayment | null>(null);
  const [printingNote, setPrintingNote] = useState<InvoiceCreditNote | null>(null);
  const [printing, setPrinting] = useState<Printing | null>(null);
  const printed = useRef(0);

  const writable = farmId !== 'all';
  const issued = ISSUED.includes(data.status);
  const { legal, ready } = useLegal(issued);
  const farmName = farms.find((f) => f.id === farmId)?.name;
  // A sheet prints once it is on the page with its legal block.
  useEffect(() => {
    if (printing && ready && printed.current !== printing.n) {
      printed.current = printing.n;
      window.print();
    }
  }, [printing, ready]);
  const print = (sheet: 'invoice' | 'delivery') => setPrinting((p) => ({ n: (p?.n ?? 0) + 1, sheet }));
  const printReceipt = (payment: InvoicePayment) => setPrinting((p) => ({ n: (p?.n ?? 0) + 1, sheet: 'receipt', payment }));

  const refresh = () => void queryClient.invalidateQueries({ queryKey: farmKey(farmId) });
  const done = () => { setActing(null); refresh(); };
  const def = invoiceStatusDef(data.status);
  const offered = INVOICE_ACTIONS.filter((a) => canRunAction(a.permission, 'ventes', can, writable) && a.visible(data));

  return (
    <>
      <div className="print:hidden">
        <DetailLayout
          back={{ to: '/m/ventes', label: 'Ventes' }}
          title={data.number ?? 'Brouillon'}
          subtitle={data.customerName}
          status={
            <>
              <Pill tone={def?.tone ?? 'neutral'}>{def?.label ?? data.status}</Pill>
              {data.refundDue > 0 && <Pill tone="danger">À rembourser {formatMoney(data.refundDue)}</Pill>}
            </>
          }
          actions={
            <>
              {offered.map((a) => (
                <Button key={a.key} variant="outline" onClick={() => setActing(a)}>
                  <a.icon aria-hidden className="size-4" />
                  {a.label}
                </Button>
              ))}
              {issued && (
                <>
                  <Button variant="outline" onClick={() => print('invoice')}>
                    <Printer aria-hidden className="size-4" />
                    Imprimer la facture
                  </Button>
                  <Button variant="outline" onClick={() => print('delivery')}>
                    <Truck aria-hidden className="size-4" />
                    Bon de livraison
                  </Button>
                </>
              )}
            </>
          }
          notice={
            <>
              {data.cancelReason && <Alert className="mb-4">{`Motif de l'annulation : ${data.cancelReason}`}</Alert>}
              {data.quoteId && (
                <Alert tone="success" className="mb-4">
                  <FileText aria-hidden className="mr-1 inline size-4" />
                  Issue du devis <Link to={`/m/ventes/devis/${data.quoteId}`} className="font-semibold underline">{data.quoteNumber}</Link>
                </Alert>
              )}
            </>
          }
          stats={[
            { label: 'Total', value: formatMoney(data.total) },
            { label: 'Payé', value: formatMoney(data.paid) },
            { label: 'Avoirs', value: formatMoney(data.credited) },
            { label: 'Reste dû', value: formatMoney(data.due) },
          ]}
          tabs={[
            { key: 'lines', label: 'Lignes', content: <LinesTab data={data} /> },
            {
              key: 'payments',
              label: 'Paiements',
              content: (
                <PaymentsTab data={data} canDelete={canRunAction('update', 'ventes', can, writable)} onReceipt={printReceipt} onDelete={setDeleting} />
              ),
            },
            { key: 'credits', label: 'Avoirs', content: <CreditNotesTab data={data} onPrint={setPrintingNote} /> },
            { key: 'history', label: 'Historique', content: <HistoryTab data={data} /> },
          ]}
        />
      </div>
      {printing?.sheet === 'invoice' && <InvoiceSheet data={data} farmName={farmName} legal={legal} />}
      {printing?.sheet === 'delivery' && <DeliveryNoteSheet data={data} farmName={farmName} legal={legal} />}
      {printing?.sheet === 'receipt' && <ReceiptSheet invoice={data} payment={printing.payment} farmName={farmName} legal={legal} />}
      {acting && <acting.Dialog row={data} onClose={() => setActing(null)} onDone={done} />}
      {printingNote && <CreditNotePrintDialog row={printingNote} onClose={() => setPrintingNote(null)} />}
      {deleting && (
        <ConfirmDialog
          title="Supprimer le paiement"
          message={`Supprimer le paiement ${deleting.number} de ${formatMoney(deleting.amount)} du ${formatDate(deleting.date)} ? Cette action est irréversible.`}
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await api.del(`/sales/${data.id}/payments/${deleting.id}`);
            setDeleting(null);
            refresh();
          }}
        />
      )}
    </>
  );
}

/**
 * `/m/ventes/:id`: one invoice with its lines, payments, credit notes and history, the workflow actions (the same list as
 * the rows of the invoices list), and the printable facture, bon de livraison and reçus.
 */
export function InvoiceDetail({ id }: { id: string }) {
  const query = useFarmQuery<InvoiceData>(['/sales', 'detail', id], () => api.get<InvoiceData>(`/sales/${id}`));

  if (query.isPending) return <div aria-busy className="h-40 animate-pulse rounded-3xl bg-muted" />;
  if (query.isError) {
    if (query.error instanceof ApiError && (query.error.status === 404 || query.error.status === 400)) return <NotFound />;
    return <ErrorRetry message={errorMessage(query.error)} onRetry={() => query.refetch()} />;
  }
  return <Loaded data={query.data} />;
}
