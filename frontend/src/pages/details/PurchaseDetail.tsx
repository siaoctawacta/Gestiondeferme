import { useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, Printer, Trash2 } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatDate, formatDateTime, formatMoney, formatNumber } from '../../lib/format';
import { farmKey, useFarmQuery } from '../../lib/query';
import { ConfirmDialog } from '../../components/module/ConfirmDialog';
import { ActionButton } from '../../components/module/DataTable';
import { ErrorRetry } from '../../components/module/ErrorRetry';
import { errorMessage } from '../../components/module/errorMessage';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Pill } from '../../components/ui/Pill';
import { Table, TD, TH, THead, TR } from '../../components/ui/Table';
import { PayDialog, PURCHASE_ACTIONS, type PurchaseActionDef } from '../../modules/purchaseActions';
import {
  ORDERED, methodLabel, statusDef, type PurchaseData, type PurchasePayment,
} from '../../modules/purchasingShared';
import NotFound from '../NotFound';
import { DetailLayout } from './DetailLayout';

/** The `legal` setting: the block printed on the bon de commande. */
type Legal = Record<'name' | 'address' | 'nif' | 'rccm', string>;

const EMPTY = <TR><TD colSpan={9} className="py-10 text-center text-muted-foreground">Aucun enregistrement</TD></TR>;

function Heads({ labels }: { labels: string[] }) {
  return (
    <THead>
      <TR className="border-b!">{labels.map((h) => <TH key={h}>{h}</TH>)}</TR>
    </THead>
  );
}

function LinesTab({ data }: { data: PurchaseData }) {
  const received = data.lines.some((l) => l.receivedQuantity !== null);
  return (
    <Card className="overflow-hidden">
      <Table>
        <Heads labels={['ARTICLE', 'QUANTITÉ', 'PRIX UNITAIRE', 'QUANTITÉ REÇUE', 'N° DE LOT', 'PÉREMPTION', 'TOTAL']} />
        <tbody>
          {data.lines.map((l) => (
            <TR key={l.itemId}>
              <TD className="font-semibold">{l.itemName}</TD>
              <TD>{formatNumber(l.quantity)} {l.unit}</TD>
              <TD>{formatMoney(l.unitPrice)}</TD>
              <TD>{l.receivedQuantity === null ? '—' : `${formatNumber(l.receivedQuantity)} ${l.unit}`}</TD>
              <TD>{l.lotNumber ?? '—'}</TD>
              <TD>{l.expiryDate ? formatDate(l.expiryDate) : '—'}</TD>
              <TD>{formatMoney((received ? (l.receivedQuantity ?? 0) : l.quantity) * l.unitPrice)}</TD>
            </TR>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}

function PaymentsTab({ data, canWrite, onPay, onDelete }: {
  data: PurchaseData; canWrite: boolean; onPay: () => void; onDelete: (p: PurchasePayment) => void;
}) {
  return (
    <>
      {canWrite && data.status === 'RECUE' && data.remaining > 0 && (
        <div className="mb-4 flex justify-end print:hidden">
          <Button onClick={onPay}><Plus aria-hidden className="size-4" />Ajouter un paiement</Button>
        </div>
      )}
      <Card className="overflow-hidden">
        <Table>
          <THead>
            <TR className="border-b!">
              {['DATE', 'MONTANT', 'MODE', 'RÉFÉRENCE'].map((h) => <TH key={h}>{h}</TH>)}
              <TH><span className="sr-only">Actions</span></TH>
            </TR>
          </THead>
          <tbody>
            {data.payments.length === 0 && <TR><TD colSpan={5} className="py-10 text-center text-muted-foreground">Aucun paiement</TD></TR>}
            {data.payments.map((p) => (
              <TR key={p.id}>
                <TD className="font-semibold">{formatDate(p.date)}</TD>
                <TD>{formatMoney(p.amount)}</TD>
                <TD>{methodLabel(p.method)}</TD>
                <TD>{p.reference ?? ''}</TD>
                <TD>
                  <div className="flex min-h-8 items-center justify-end">
                    {canWrite && (
                      <ActionButton label="Supprimer" onClick={() => onDelete(p)}><Trash2 aria-hidden className="size-4" /></ActionButton>
                    )}
                  </div>
                </TD>
              </TR>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}

function HistoryTab({ data }: { data: PurchaseData }) {
  return (
    <Card className="overflow-hidden">
      <Table>
        <Heads labels={['ÉTAPE', 'DATE', 'PAR', 'NOTE']} />
        <tbody>
          {data.history.length === 0 && EMPTY}
          {data.history.map((h) => (
            <TR key={h.step}>
              <TD className="font-semibold">{statusDef(h.step)?.label ?? h.step}</TD>
              <TD>{formatDateTime(h.at)}</TD>
              <TD>{h.by ?? '—'}</TD>
              <TD>{h.note ?? ''}</TD>
            </TR>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="flex gap-2"><dt className="text-muted-foreground">{label}</dt><dd className="font-medium">{children}</dd></div>
);

/**
 * The bon de commande: shown only when printing (`print:block`), the screen layout being hidden then. It states what
 * was ordered, whatever was received since. The legal block comes from the settings and is left out when the user
 * cannot read them.
 */
function PurchaseOrderSheet({ data, farmName, legal }: { data: PurchaseData; farmName: string | undefined; legal: Legal | undefined }) {
  const total = data.lines.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0);
  return (
    <section aria-label="Bon de commande" className="hidden space-y-6 text-sm print:block">
      <header className="flex items-start justify-between gap-6 border-b border-border pb-4">
        <div>
          <p className="text-lg font-bold">{legal?.name || farmName}</p>
          {legal?.address && <p>{legal.address}</p>}
          {(legal?.nif || legal?.rccm) && (
            <p>{[legal.nif && `NIF : ${legal.nif}`, legal.rccm && `RCCM : ${legal.rccm}`].filter(Boolean).join(' · ')}</p>
          )}
        </div>
        <div className="text-right">
          <h2 className="text-2xl font-bold">Bon de commande</h2>
          <p>Référence : {data.reference}</p>
          <p>Date : {formatDate(data.date)}</p>
        </div>
      </header>
      <dl className="space-y-1">
        <Row label="Fournisseur :">{data.supplierName}</Row>
      </dl>
      <Table>
        <Heads labels={['ARTICLE', 'QUANTITÉ', 'PRIX UNITAIRE', 'MONTANT']} />
        <tbody>
          {data.lines.map((l) => (
            <TR key={l.itemId}>
              <TD>{l.itemName}</TD>
              <TD>{formatNumber(l.quantity)} {l.unit}</TD>
              <TD>{formatMoney(l.unitPrice)}</TD>
              <TD>{formatMoney(l.quantity * l.unitPrice)}</TD>
            </TR>
          ))}
        </tbody>
      </Table>
      <p className="text-right text-base font-bold">Total : {formatMoney(Math.round(total * 100) / 100)}</p>
    </section>
  );
}

function Loaded({ data }: { data: PurchaseData }) {
  const { can, farmId, farms } = useAuth();
  const queryClient = useQueryClient();
  const [acting, setActing] = useState<PurchaseActionDef | null>(null);
  const [paying, setPaying] = useState(false);
  const [deleting, setDeleting] = useState<PurchasePayment | null>(null);

  const writable = farmId !== 'all';
  const printable = ORDERED.includes(data.status);
  const legal = useFarmQuery<Record<string, unknown>>(['settings'], () => api.get<Record<string, unknown>>('/settings'), {
    enabled: printable && can('parametres', 'read'),
  });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: farmKey(farmId) });
  const done = () => { setActing(null); setPaying(false); refresh(); };
  const def = statusDef(data.status);
  const offered = PURCHASE_ACTIONS.filter((a) => writable && can('achats', a.permission) && a.visible(data));

  return (
    <>
      <div className="print:hidden">
        <DetailLayout
          back={{ to: '/m/achats', label: 'Achats' }}
          title={data.reference}
          subtitle={data.supplierName}
          status={<Pill tone={def?.tone ?? 'neutral'}>{def?.label ?? data.status}</Pill>}
          actions={
            <>
              {offered.map((a) => (
                <Button key={a.key} variant="outline" onClick={() => setActing(a)}>
                  <a.icon aria-hidden className="size-4" />
                  {a.label}
                </Button>
              ))}
              {printable && (
                <Button variant="outline" onClick={() => window.print()}>
                  <Printer aria-hidden className="size-4" />
                  Imprimer
                </Button>
              )}
            </>
          }
          stats={[
            { label: 'Montant', value: formatMoney(data.amount) },
            { label: 'Payé', value: formatMoney(data.paid) },
            { label: 'Reste', value: formatMoney(data.remaining) },
          ]}
          tabs={[
            { key: 'lines', label: 'Lignes', content: <LinesTab data={data} /> },
            {
              key: 'payments',
              label: 'Paiements',
              content: <PaymentsTab data={data} canWrite={writable && can('achats', 'update')} onPay={() => setPaying(true)} onDelete={setDeleting} />,
            },
            { key: 'history', label: 'Historique', content: <HistoryTab data={data} /> },
          ]}
        />
      </div>
      {printable && (
        <PurchaseOrderSheet
          data={data}
          farmName={farms.find((f) => f.id === farmId)?.name}
          legal={legal.data?.legal as Legal | undefined}
        />
      )}
      {acting && <acting.Dialog row={data} onClose={() => setActing(null)} onDone={done} />}
      {paying && <PayDialog row={data} onClose={() => setPaying(false)} onDone={done} />}
      {deleting && (
        <ConfirmDialog
          title="Supprimer le paiement"
          message={`Supprimer le paiement de ${formatMoney(deleting.amount)} du ${formatDate(deleting.date)} ? Cette action est irréversible.`}
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await api.del(`/purchases/${data.id}/payments/${deleting.id}`);
            setDeleting(null);
            refresh();
          }}
        />
      )}
    </>
  );
}

/** `/m/achats/:id`: one purchase with its lines, payments and history, the workflow actions, and the printable bon de commande. */
export function PurchaseDetail({ id }: { id: string }) {
  const query = useFarmQuery<PurchaseData>(['/purchases', 'detail', id], () => api.get<PurchaseData>(`/purchases/${id}`));

  if (query.isPending) return <div aria-busy className="h-40 animate-pulse rounded-3xl bg-muted" />;
  if (query.isError) {
    if (query.error instanceof ApiError && (query.error.status === 404 || query.error.status === 400)) return <NotFound />;
    return <ErrorRetry message={errorMessage(query.error)} onRetry={() => query.refetch()} />;
  }
  return <Loaded data={query.data} />;
}
