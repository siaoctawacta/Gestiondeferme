import { useState } from 'react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatDate, formatMoney, formatNumber } from '../../lib/format';
import { lineAmount } from '../../lib/money';
import { farmKey, useFarmQuery } from '../../lib/query';
import { ErrorRetry } from '../../components/module/ErrorRetry';
import { errorMessage } from '../../components/module/errorMessage';
import { canRunAction } from '../../components/module/rowActions';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Pill } from '../../components/ui/Pill';
import { Table, TD, TH, THead, TR } from '../../components/ui/Table';
import { kindLabel } from '../../modules/saleLines';
import { QUOTE_ACTIONS, quoteStatusDef, type QuoteActionDef, type QuoteData } from '../../modules/salesShared';
import NotFound from '../NotFound';
import { DetailLayout } from './DetailLayout';

/** The `legal` setting: the block printed on the sheet. */
type Legal = Record<'name' | 'address' | 'nif' | 'rccm', string>;

/** `plain`: no tinted background (the printed sheet rules a border instead). */
function Heads({ labels, plain = false }: { labels: string[]; plain?: boolean }) {
  return (
    <THead className={plain ? 'bg-transparent! border-b-2 border-foreground [&_th]:text-foreground!' : ''}>
      <TR className="border-b!">{labels.map((h) => <TH key={h}>{h}</TH>)}</TR>
    </THead>
  );
}

const quantityOf = (l: QuoteData['lines'][number]) => {
  const unit = l.kind === 'OEUFS' ? (l.unit === 'OEUF' ? 'œuf' : 'plateau') : '';
  return unit ? `${formatNumber(l.quantity)} ${unit}` : formatNumber(l.quantity);
};

function LinesTab({ data }: { data: QuoteData }) {
  return (
    <Card className="overflow-hidden">
      <Table>
        <Heads labels={['TYPE', 'SOURCE', 'DÉSIGNATION', 'QUANTITÉ', 'PRIX UNITAIRE', 'TOTAL']} />
        <tbody>
          {data.lines.map((l) => (
            <TR key={l.position}>
              <TD>{kindLabel(l.kind)}</TD>
              <TD>{l.sourceLabel ?? '—'}</TD>
              <TD className="font-semibold">{l.designation}</TD>
              <TD>{quantityOf(l)}</TD>
              <TD>{formatMoney(l.unitPrice)}</TD>
              <TD>{formatMoney(l.amount)}</TD>
            </TR>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}

function HistoryTab({ data }: { data: QuoteData }) {
  return (
    <Card className="overflow-hidden">
      <Table>
        <Heads labels={['ÉTAPE', 'DATE', 'PAR']} />
        <tbody>
          {data.history.length === 0 && <TR><TD colSpan={3} className="py-10 text-center text-muted-foreground">Aucun enregistrement</TD></TR>}
          {data.history.map((h, i) => (
            <TR key={`${i}-${h.step}`}>
              <TD className="font-semibold">{quoteStatusDef(h.step)?.label ?? h.step}</TD>
              <TD>{formatDate(h.at)}</TD>
              <TD>{h.by ?? '—'}</TD>
            </TR>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}

/**
 * The devis sheet: shown only when printing (`print:block`), the screen layout being hidden then. The legal block
 * comes from the settings and is left out when the user cannot read them.
 */
function QuoteSheet({ data, farmName, legal }: { data: QuoteData; farmName: string | undefined; legal: Legal | undefined }) {
  const total = data.lines.reduce((sum, l) => sum + lineAmount(l.quantity, l.unitPrice), 0);
  return (
    <section aria-label="Devis" className="hidden space-y-6 text-sm print:block">
      <header className="flex items-start justify-between gap-6 border-b border-border pb-4">
        <div>
          <p className="text-lg font-bold">{legal?.name || farmName}</p>
          {legal?.address && <p>{legal.address}</p>}
          {(legal?.nif || legal?.rccm) && (
            <p>{[legal.nif && `NIF : ${legal.nif}`, legal.rccm && `RCCM : ${legal.rccm}`].filter(Boolean).join(' · ')}</p>
          )}
        </div>
        <div className="text-right">
          <h2 className="text-2xl font-bold">Devis</h2>
          <p>Référence : {data.reference}</p>
          <p>Date : {formatDate(data.date)}</p>
          {data.validUntil && <p>Valable jusqu'au {formatDate(data.validUntil)}</p>}
        </div>
      </header>
      <div>
        <p className="text-xs uppercase tracking-wider text-muted-foreground">Client</p>
        <span className="block font-semibold">{data.customerName}</span>
        {data.customerAddress && <p>{data.customerAddress}</p>}
        {data.customerPhone && <p>{data.customerPhone}</p>}
      </div>
      <Table>
        <Heads plain labels={['DÉSIGNATION', 'QUANTITÉ', 'PRIX UNITAIRE', 'MONTANT']} />
        <tbody>
          {data.lines.map((l) => (
            <TR key={l.position}>
              <TD>{l.designation}</TD>
              <TD>{quantityOf(l)}</TD>
              <TD>{formatMoney(l.unitPrice)}</TD>
              <TD>{formatMoney(lineAmount(l.quantity, l.unitPrice))}</TD>
            </TR>
          ))}
        </tbody>
      </Table>
      <p className="text-right text-base font-bold">Total : {formatMoney(Math.round(total * 100) / 100)}</p>
    </section>
  );
}

function Loaded({ data }: { data: QuoteData }) {
  const { can, farmId, farms } = useAuth();
  const queryClient = useQueryClient();
  const [acting, setActing] = useState<QuoteActionDef | null>(null);

  const writable = farmId !== 'all';
  const legal = useFarmQuery<Record<string, unknown>>(['settings'], () => api.get<Record<string, unknown>>('/settings'), {
    enabled: can('parametres', 'read'),
  });
  const done = () => { setActing(null); void queryClient.invalidateQueries({ queryKey: farmKey(farmId) }); };
  const def = quoteStatusDef(data.status);
  const offered = QUOTE_ACTIONS.filter((a) => canRunAction(a.permission, 'ventes', can, writable) && a.visible(data));

  return (
    <>
      <div className="print:hidden">
        <DetailLayout
          back={{ to: '/m/ventes', label: 'Ventes' }}
          title={data.reference}
          subtitle={data.customerName}
          status={<Pill tone={def?.tone ?? 'neutral'}>{def?.label ?? data.status}</Pill>}
          actions={
            <>
              {offered.map((a) => (
                <Button key={a.key} variant="outline" onClick={() => setActing(a)}>
                  <a.icon aria-hidden className="size-4" />
                  {a.label}
                </Button>
              ))}
              <Button variant="outline" onClick={() => window.print()}>
                <Printer aria-hidden className="size-4" />
                Imprimer
              </Button>
            </>
          }
          notice={
            data.invoiceId ? (
              <Alert tone="success" className="mb-4">
                Facturé : <Link to={`/m/ventes/${data.invoiceId}`} className="font-semibold underline">{data.invoiceNumber ?? 'facture brouillon'}</Link>
              </Alert>
            ) : undefined
          }
          stats={[
            { label: 'Total', value: formatMoney(data.total) },
            { label: 'Date', value: formatDate(data.date) },
            { label: "Valable jusqu'au", value: data.validUntil ? formatDate(data.validUntil) : '—' },
          ]}
          tabs={[
            { key: 'lines', label: 'Lignes', content: <LinesTab data={data} /> },
            { key: 'history', label: 'Historique', content: <HistoryTab data={data} /> },
          ]}
        />
      </div>
      <QuoteSheet data={data} farmName={farms.find((f) => f.id === farmId)?.name} legal={legal.data?.legal as Legal | undefined} />
      {acting && <acting.Dialog row={data} onClose={() => setActing(null)} onDone={done} />}
    </>
  );
}

/** `/m/ventes/devis/:id`: one quote with its lines and history, the workflow actions, and the printable devis. */
export function QuoteDetail({ id }: { id: string }) {
  const query = useFarmQuery<QuoteData>(['/quotes', 'detail', id], () => api.get<QuoteData>(`/quotes/${id}`));

  if (query.isPending) return <div aria-busy className="h-40 animate-pulse rounded-3xl bg-muted" />;
  if (query.isError) {
    if (query.error instanceof ApiError && (query.error.status === 404 || query.error.status === 400)) return <NotFound />;
    return <ErrorRetry message={errorMessage(query.error)} onRetry={() => query.refetch()} />;
  }
  return <Loaded data={query.data} />;
}
