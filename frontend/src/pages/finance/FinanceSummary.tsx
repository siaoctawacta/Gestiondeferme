import { api } from '../../lib/api';
import { formatMoney, signedMoney } from '../../lib/format';
import { useFarmQuery } from '../../lib/query';
import { ErrorRetry } from '../../components/module/ErrorRetry';
import { errorMessage } from '../../components/module/errorMessage';
import { DateFilter } from '../../components/module/DateFilter';
import { useSharedFilters } from '../../components/module/sharedFilters';
import { StatTiles } from '../../components/module/StatTiles';
import { Card } from '../../components/ui/Card';
import { Table, TD, TH, THead, TR } from '../../components/ui/Table';
import { ActivityCards, SUMS_HINT, kindLabel, type FinanceSummaryDto } from '../../modules/financeShared';
import { Skeleton } from '../PageParts';

/** The same hint as the plan words it: consumption is counted in the lots' cost, not as an expense. */
const CONSUMPTION_HINT = "La consommation d'aliments et de produits vétérinaires n'est pas une dépense : elle est comptée dans le coût des lots.";

/**
 * `Synthèse` tab: the farm view (recettes − dépenses) over a period, from `GET /finance/summary`. Every figure is the
 * API's; the browser only formats. Under "all farms" the API adds the per-farm table.
 */
export function FinanceSummary() {
  const { values, set, error } = useSharedFilters();
  const from = values.from ?? '';
  const to = values.to ?? '';
  const query = useFarmQuery<FinanceSummaryDto>(
    ['/finance/summary', from, to],
    () => api.get<FinanceSummaryDto>('/finance/summary', { from: from || undefined, to: to || undefined }),
    { enabled: !error },
  );
  const d = query.data;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-4">
        <DateFilter label="Du" value={from} onChange={(v) => set('from', v)} />
        <DateFilter label="Au" value={to} onChange={(v) => set('to', v)} />
      </div>
      {query.isError ? (
        <ErrorRetry message={errorMessage(query.error)} onRetry={() => query.refetch()} />
      ) : error ? null : !d ? (
        <Skeleton aria-busy="true" aria-label="Chargement" className="h-64" />
      ) : (
        <>
          <div className="[&>div]:mb-0">
            <StatTiles
              tiles={[
                { label: "Chiffre d'affaires", value: formatMoney(d.revenue) },
                { label: 'Dépenses', value: formatMoney(d.expenses) },
                { label: 'Marge', value: signedMoney(d.margin) },
                { label: 'Créances clients', value: formatMoney(d.receivables) },
              ]}
            />
          </div>
          <ActivityCards rows={d.byActivity} />
          <Card className="overflow-hidden">
            <Table>
              <THead>
                <TR className="border-b!">
                  <TH>CATÉGORIE</TH>
                  <TH>TYPE</TH>
                  <TH className="text-right">MONTANT</TH>
                </TR>
              </THead>
              <tbody>
                {d.byCategory.length === 0 && (
                  <TR><TD colSpan={3} className="py-10 text-center text-muted-foreground">Aucun enregistrement</TD></TR>
                )}
                {d.byCategory.map((c) => (
                  <TR key={`${c.kind}-${c.category}`}>
                    <TD className="font-semibold">{c.label}</TD>
                    <TD>{kindLabel(c.kind)}</TD>
                    <TD className="text-right">{formatMoney(c.amount)}</TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          </Card>
          {d.byFarm && d.byFarm.length > 0 && (
            <Card className="overflow-hidden">
              <Table>
                <THead>
                  <TR className="border-b!">
                    <TH>FERME</TH>
                    <TH className="text-right">RECETTES</TH>
                    <TH className="text-right">DÉPENSES</TH>
                    <TH className="text-right">MARGE</TH>
                  </TR>
                </THead>
                <tbody>
                  {d.byFarm.map((f) => (
                    <TR key={f.farmId}>
                      <TD className="font-semibold">{f.farmName}</TD>
                      <TD className="text-right">{formatMoney(f.revenue)}</TD>
                      <TD className="text-right">{formatMoney(f.expenses)}</TD>
                      <TD className="text-right">{signedMoney(f.margin)}</TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            </Card>
          )}
          <div className="space-y-1 text-xs text-muted-foreground">
            <p>{CONSUMPTION_HINT}</p>
            <p>{SUMS_HINT}</p>
          </div>
        </>
      )}
    </div>
  );
}
