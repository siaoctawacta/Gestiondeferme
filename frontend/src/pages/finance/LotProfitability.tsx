import { api, ApiError } from '../../lib/api';
import { formatDecimal, formatMoney, formatNumber, orDash, signedMoney } from '../../lib/format';
import { useFarmQuery } from '../../lib/query';
import { ErrorRetry } from '../../components/module/ErrorRetry';
import { errorMessage } from '../../components/module/errorMessage';
import { ModuleList } from '../../components/module/ModulePage';
import type { ModuleConfig } from '../../components/module/types';
import { Card } from '../../components/ui/Card';
import { MarginPill, SUMS_HINT, type LotProfitRow } from '../../modules/financeShared';
import { STATUSES, TYPE_LABELS } from '../../modules/lotsShared';
import { Skeleton } from '../PageParts';

/** The formula the API applies, printed under the table and on the lot's card. */
export const LOT_MARGIN_HINT = 'Marge du lot = recettes du lot − (achat des animaux + aliment + santé + charges affectées).';

/** A cost per animal or per kg: two decimals at most, `—` when the API cannot compute it (no animals, no weights). */
const unitCost = (n: number | null) => orDash(n, (v) => `${formatDecimal(v, 2)} FCFA`);

/**
 * The `Rentabilité par lot` list: read-only, one row per lot over a period (`from` / `to`), linking to the lot. A pig
 * lot opens under `porcs`, as its own list does. Its period is the page's shared one.
 */
export const lotProfitability: ModuleConfig<LotProfitRow> = {
  slug: 'finance',
  group: 'Finance',
  title: 'Rentabilité par lot',
  subtitle: 'Coût, recettes et marge de chaque lot.',
  endpoint: '/finance/lots',
  columns: [
    { key: 'code', header: 'LOT' },
    { key: 'type', header: 'TYPE', render: (l) => TYPE_LABELS[l.type] ?? l.type },
    { key: 'status', header: 'STATUT' },
    { key: 'sold', header: 'VENDUS', render: (l) => formatNumber(l.sold) },
    { key: 'totalCost', header: 'COÛT TOTAL', render: (l) => formatMoney(l.totalCost) },
    { key: 'revenue', header: 'RECETTES', render: (l) => signedMoney(l.revenue) },
    { key: 'margin', header: 'MARGE', render: (l) => <MarginPill value={l.margin} /> },
    { key: 'costPerAnimal', header: 'COÛT / ANIMAL', render: (l) => unitCost(l.costPerAnimal) },
    { key: 'costPerKg', header: 'COÛT / KG', render: (l) => unitCost(l.costPerKg) },
  ],
  statuses: STATUSES,
  statusKey: 'status',
  filters: [
    { param: 'from', allLabel: 'Du', type: 'date' },
    { param: 'to', allLabel: 'Au', type: 'date' },
    {
      param: 'species',
      allLabel: 'Toutes les espèces',
      options: [{ value: 'AVICOLE', label: 'Avicole' }, { value: 'PORCIN', label: 'Porcin' }],
    },
  ],
  fields: [],
  noCreate: true,
  canEdit: () => false,
  canDelete: () => false,
  rowLabel: (l) => l.code,
  // The lot page needs the species module's read right: without it the code is plain text.
  detailPath: (l, { can }) =>
    l.species === 'PORCIN'
      ? (can('porcs', 'read') ? `/m/porcs/lot-${l.batchId}` : undefined)
      : (can('lots', 'read') ? `/m/lots/${l.batchId}` : undefined),
};

/** `Rentabilité par lot` tab: the list and what its margin means. */
export function LotProfitabilityTab() {
  return (
    <>
      <ModuleList config={lotProfitability} />
      <div className="mt-3 space-y-1 text-xs text-muted-foreground">
        <p>{LOT_MARGIN_HINT}</p>
        <p>{SUMS_HINT}</p>
      </div>
    </>
  );
}

function Line({ label, value, strong }: { label: string; value: React.ReactNode; strong?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-3 py-1.5 ${strong ? 'border-t border-border pt-2.5 font-semibold' : ''}`}>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={strong ? '' : 'font-medium'}>{value}</dd>
    </div>
  );
}

/**
 * The `Rentabilité` card of a lot's detail page: what the lot cost, what it earned, its margin. It needs `finance` read
 * only (no other module): the caller shows it for that role alone, and the API figures are shown as they come.
 */
export function LotProfitabilityCard({ batchId }: { batchId: string }) {
  const query = useFarmQuery<LotProfitRow>(['/finance/lots', 'detail', batchId], () => api.get<LotProfitRow>(`/finance/lots/${batchId}`));
  // A lot the finance view does not know yet (404) simply has no card.
  if (query.isError && query.error instanceof ApiError && query.error.status === 404) return null;
  return (
    <section aria-label="Rentabilité">
      <Card className="p-5">
        <h2 className="text-lg font-bold">Rentabilité</h2>
        {query.isError ? (
          <ErrorRetry message={errorMessage(query.error)} onRetry={() => query.refetch()} />
        ) : !query.data ? (
          <Skeleton aria-busy="true" aria-label="Chargement" className="mt-3 h-40" />
        ) : (
          <>
            <dl className="mt-2 text-sm">
              <Line label="Coût des animaux" value={formatMoney(query.data.costs.animaux)} />
              <Line label="Aliment" value={formatMoney(query.data.costs.aliment)} />
              <Line label="Santé" value={formatMoney(query.data.costs.sante)} />
              <Line label="Autres charges" value={formatMoney(query.data.costs.autres)} />
              <Line strong label="Coût total" value={formatMoney(query.data.totalCost)} />
              <Line label="Recettes" value={signedMoney(query.data.revenue)} />
              <Line strong label="Marge du lot" value={<MarginPill value={query.data.margin} />} />
              <Line label="Coût / animal" value={unitCost(query.data.costPerAnimal)} />
              <Line label="Coût / kg" value={unitCost(query.data.costPerKg)} />
            </dl>
            <p className="mt-3 text-xs text-muted-foreground">{LOT_MARGIN_HINT}</p>
          </>
        )}
      </Card>
    </section>
  );
}
