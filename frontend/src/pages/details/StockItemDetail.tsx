import { api, ApiError } from '../../lib/api';
import { formatDate, formatMoney, formatNumber, orDash, todayIso } from '../../lib/format';
import { useFarmQuery } from '../../lib/query';
import { ErrorRetry } from '../../components/module/ErrorRetry';
import { errorMessage } from '../../components/module/errorMessage';
import { ModuleList } from '../../components/module/ModulePage';
import { Card } from '../../components/ui/Card';
import { Pill } from '../../components/ui/Pill';
import { Table, TD, TH, THead, TR } from '../../components/ui/Table';
import { categoryLabel, levelPill, stockMovements, type StockItemDetailData } from '../../modules/stocksShared';
import NotFound from '../NotFound';
import { DetailLayout } from './DetailLayout';

/** A batch expiring within this many days is flagged `Bientôt périmé`. */
const SOON_DAYS = 30;

const addDays = (iso: string, days: number) => new Date(new Date(iso).getTime() + days * 86400000).toISOString().slice(0, 10);

/** Expiry pill of a batch: `Périmé` once the date is past, `Bientôt périmé` within 30 days, nothing otherwise. */
function expiryPill(expiryDate: string | null) {
  if (!expiryDate) return null;
  const today = todayIso();
  if (expiryDate < today) return <Pill tone="danger">Périmé</Pill>;
  if (expiryDate <= addDays(today, SOON_DAYS)) return <Pill tone="warning">Bientôt périmé</Pill>;
  return null;
}

function BatchesTab({ batches }: { batches: StockItemDetailData['batches'] }) {
  return (
    <Card className="overflow-hidden">
      <Table>
        <THead>
          <TR className="border-b!">
            {['N° DE LOT', 'REÇU LE', 'PÉREMPTION', 'QUANTITÉ'].map((h) => <TH key={h}>{h}</TH>)}
            <TH><span className="sr-only">État</span></TH>
          </TR>
        </THead>
        <tbody>
          {batches.length === 0 && (
            <TR><TD colSpan={5} className="py-10 text-center text-muted-foreground">Aucun lot en stock</TD></TR>
          )}
          {batches.map((b) => (
            <TR key={b.id}>
              <TD className="font-semibold">{b.lotNumber ?? '—'}</TD>
              <TD>{formatDate(b.receivedDate)}</TD>
              <TD>{b.expiryDate ? formatDate(b.expiryDate) : '—'}</TD>
              <TD>{formatNumber(b.quantity)}</TD>
              <TD>{expiryPill(b.expiryDate)}</TD>
            </TR>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}

/** `/m/stocks/:id`: one stock item with its key figures, batches (with expiry) and movements. */
export function StockItemDetail({ id }: { id: string }) {
  const query = useFarmQuery<StockItemDetailData>(['/stock', 'detail', id], () => api.get<StockItemDetailData>(`/stock/${id}`));

  if (query.isPending) return <div aria-busy className="h-40 animate-pulse rounded-3xl bg-muted" />;
  if (query.isError) {
    if (query.error instanceof ApiError && (query.error.status === 404 || query.error.status === 400)) return <NotFound />;
    return <ErrorRetry message={errorMessage(query.error)} onRetry={() => query.refetch()} />;
  }

  const item = query.data;
  return (
    <DetailLayout
      back={{ to: '/m/stocks', label: 'Stocks' }}
      title={item.name}
      subtitle={`${categoryLabel(item.category)} · ${item.unit}`}
      status={levelPill(item.level)}
      stats={[
        { label: 'Quantité', value: `${formatNumber(item.quantity)} ${item.unit}` },
        { label: 'Valeur', value: formatMoney(item.value) },
        { label: 'Coût moyen', value: `${formatMoney(item.averageCost)}/${item.unit}` },
        { label: 'Jours de stock', value: orDash(item.daysOfStock) },
      ]}
      tabs={[
        { key: 'lots', label: 'Lots', content: <BatchesTab batches={item.batches} /> },
        { key: 'movements', label: 'Mouvements', content: <ModuleList config={stockMovements} scope={{ itemId: id }} /> },
      ]}
    />
  );
}
