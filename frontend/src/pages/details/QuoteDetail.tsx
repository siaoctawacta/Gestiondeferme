import { useState } from 'react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatDate, formatMoney } from '../../lib/format';
import { farmKey, useFarmQuery } from '../../lib/query';
import { ErrorRetry } from '../../components/module/ErrorRetry';
import { errorMessage } from '../../components/module/errorMessage';
import { canRunAction } from '../../components/module/rowActions';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Pill } from '../../components/ui/Pill';
import { Table, TD, TR } from '../../components/ui/Table';
import { kindLabel, lineQuantityLabel } from '../../modules/saleLines';
import { QUOTE_ACTIONS, quoteStatusDef, type QuoteActionDef, type QuoteData } from '../../modules/salesShared';
import NotFound from '../NotFound';
import { QuoteSheet } from '../print/SaleSheets';
import { SheetHeads, useLegal } from '../print/SheetFrame';
import { DetailLayout } from './DetailLayout';

function LinesTab({ data }: { data: QuoteData }) {
  return (
    <Card className="overflow-hidden">
      <Table>
        <SheetHeads labels={['TYPE', 'SOURCE', 'DÉSIGNATION', 'QUANTITÉ', 'PRIX UNITAIRE', 'TOTAL']} />
        <tbody>
          {data.lines.map((l) => (
            <TR key={l.position}>
              <TD>{kindLabel(l.kind)}</TD>
              <TD>{l.sourceLabel ?? '—'}</TD>
              <TD className="font-semibold">{l.designation}</TD>
              <TD>{lineQuantityLabel(l)}</TD>
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
        <SheetHeads labels={['ÉTAPE', 'DATE', 'PAR']} />
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

function Loaded({ data }: { data: QuoteData }) {
  const { can, farmId, farms } = useAuth();
  const queryClient = useQueryClient();
  const [acting, setActing] = useState<QuoteActionDef | null>(null);

  const writable = farmId !== 'all';
  const { legal } = useLegal();
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
      <QuoteSheet data={data} farmName={farms.find((f) => f.id === farmId)?.name} legal={legal} />
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
