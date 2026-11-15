import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Printer, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatDate, formatMoney, formatNumber } from '../../lib/format';
import { farmKey, useFarmQuery } from '../../lib/query';
import { ConfirmDialog } from '../../components/module/ConfirmDialog';
import { ActionButton } from '../../components/module/DataTable';
import { canRunAction } from '../../components/module/rowActions';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Pill } from '../../components/ui/Pill';
import { Table, TD, TH, THead, TR } from '../../components/ui/Table';
import { PURCHASE_ACTIONS, type PurchaseActionDef } from '../../modules/purchaseActions';
import {
  ORDERED, activityLabel, methodLabel, statusDef, type PurchaseData, type PurchasePayment,
} from '../../modules/purchasingShared';
import { DetailGate } from './DetailGate';
import { HistoryTab } from './HistoryTab';
import { SheetFrame, SheetHeads, SheetTable, SheetTotal, useLegal, type Legal } from '../print/SheetFrame';
import { DetailLayout } from './DetailLayout';

function LinesTab({ data }: { data: PurchaseData }) {
  return (
    <Card className="overflow-hidden">
      <Table>
        <SheetHeads labels={['ARTICLE', 'QUANTITÉ', 'PRIX UNITAIRE', 'QUANTITÉ REÇUE', 'N° DE LOT', 'PÉREMPTION', 'TOTAL']} />
        <tbody>
          {data.lines.map((l) => (
            <TR key={l.itemId}>
              <TD className="font-semibold">{l.itemName}</TD>
              <TD>{formatNumber(l.quantity)} {l.unit}</TD>
              <TD>{formatMoney(l.unitPrice)}</TD>
              <TD>{l.receivedQuantity === null ? '—' : `${formatNumber(l.receivedQuantity)} ${l.unit}`}</TD>
              <TD>{l.lotNumber ?? '—'}</TD>
              <TD>{l.expiryDate ? formatDate(l.expiryDate) : '—'}</TD>
              <TD>{formatMoney(l.amount)}</TD>
            </TR>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}

function PaymentsTab({ data, canDelete, onDelete }: { data: PurchaseData; canDelete: boolean; onDelete: (p: PurchasePayment) => void }) {
  return (
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
                  {canDelete && (
                    <ActionButton label="Supprimer" onClick={() => onDelete(p)}><Trash2 aria-hidden className="size-4" /></ActionButton>
                  )}
                </div>
              </TD>
            </TR>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}

/**
 * The bon de commande: it states what was ordered, whatever was received since. The legal block comes from the
 * settings and is left out when the user cannot read them.
 */
function PurchaseOrderSheet({ data, farmName, legal }: { data: PurchaseData; farmName: string | undefined; legal: Legal | undefined }) {
  // What was ordered, as the API computed each line; the sum of 2-decimal amounts, re-rounded only against float noise.
  const total = Math.round(data.lines.reduce((sum, l) => sum + l.orderedAmount, 0) * 100) / 100;
  return (
    <SheetFrame
      label="Bon de commande"
      meta={
        <>
          <p>Référence : {data.reference}</p>
          {data.requestNumber !== data.reference && <p>Demande : {data.requestNumber}</p>}
          <p>Date : {formatDate(data.orderedAt ?? data.date)}</p>
        </>
      }
      partyLabel="Fournisseur"
      party={{ name: data.supplierName, address: data.supplierAddress, phone: data.supplierPhone }}
      farmName={farmName}
      legal={legal}
    >
      <SheetTable labels={['ARTICLE', 'QUANTITÉ', 'PRIX UNITAIRE', 'MONTANT']}>
        {data.lines.map((l) => (
          <TR key={l.itemId}>
            <TD>{l.itemName}</TD>
            <TD>{formatNumber(l.quantity)} {l.unit}</TD>
            <TD>{formatMoney(l.unitPrice)}</TD>
            <TD>{formatMoney(l.orderedAmount)}</TD>
          </TR>
        ))}
      </SheetTable>
      <SheetTotal total={total} />
    </SheetFrame>
  );
}

function Loaded({ data }: { data: PurchaseData }) {
  const { can, farmId, farms } = useAuth();
  const queryClient = useQueryClient();
  const [acting, setActing] = useState<PurchaseActionDef | null>(null);
  const [deleting, setDeleting] = useState<PurchasePayment | null>(null);

  const writable = farmId !== 'all';
  const printable = ORDERED.includes(data.status);
  const { legal } = useLegal(printable);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: farmKey(farmId) });
  const done = () => { setActing(null); refresh(); };
  const def = statusDef(data.status);
  const offered = PURCHASE_ACTIONS.filter((a) => canRunAction(a.permission, 'achats', can, writable) && a.visible(data));

  return (
    <>
      <div className="print:hidden">
        <DetailLayout
          back={{ to: '/m/achats', label: 'Achats' }}
          title={data.reference}
          subtitle={data.supplierName}
          status={
            <>
              <Pill tone={def?.tone ?? 'neutral'}>{def?.label ?? data.status}</Pill>
              <Pill tone="neutral">{activityLabel(data.activity)}</Pill>
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
              {printable && (
                <Button variant="outline" onClick={() => window.print()}>
                  <Printer aria-hidden className="size-4" />
                  Imprimer
                </Button>
              )}
            </>
          }
          notice={data.cancelReason ? <Alert className="mb-4">{`Motif de l'annulation : ${data.cancelReason}`}</Alert> : undefined}
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
              content: <PaymentsTab data={data} canDelete={canRunAction('validate', 'achats', can, writable)} onDelete={setDeleting} />,
            },
            { key: 'history', label: 'Historique', content: <HistoryTab steps={data.history} label={(s) => statusDef(s)?.label ?? s} withNote /> },
          ]}
        />
      </div>
      {printable && (
        <PurchaseOrderSheet
          data={data}
          farmName={farms.find((f) => f.id === farmId)?.name}
          legal={legal}
        />
      )}
      {acting && <acting.Dialog row={data} onClose={() => setActing(null)} onDone={done} />}
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
  return <DetailGate query={query}>{(data) => <Loaded data={data} />}</DetailGate>;
}
