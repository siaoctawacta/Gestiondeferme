import { useState } from 'react';
import { api } from '../../lib/api';
import { formatMoney, todayIso } from '../../lib/format';
import { useFarmQuery } from '../../lib/query';
import { ErrorRetry } from '../../components/module/ErrorRetry';
import { errorMessage } from '../../components/module/errorMessage';
import { StatTiles } from '../../components/module/StatTiles';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { Table, TD, TH, THead, TR } from '../../components/ui/Table';
import { ActivityCards, SUMS_HINT, kindLabel, type FinanceSummaryDto } from '../../modules/financeShared';
import { Skeleton } from '../PageParts';

/** The same hint as the plan words it: consumption is counted in the lots' cost, not as an expense. */
const CONSUMPTION_HINT = "La consommation d'aliments et de produits vétérinaires n'est pas une dépense : elle est comptée dans le coût des lots.";

/** First day of the current month to today: the period the API itself defaults to. */
const monthToDate = () => ({ from: `${todayIso().slice(0, 8)}01`, to: todayIso() });

function DateBox({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
      {label}
      <Input type="date" className="h-9! w-auto! px-3!" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

/**
 * `Synthèse` tab: the farm view (recettes − dépenses) over a period, from `GET /finance/summary`. Every figure is the
 * API's; the browser only formats. Under "all farms" the API adds the per-farm table.
 */
export function FinanceSummary() {
  const [period, setPeriod] = useState(monthToDate);
  const { from, to } = period;
  const query = useFarmQuery<FinanceSummaryDto>(
    ['/finance/summary', from, to],
    () => api.get<FinanceSummaryDto>('/finance/summary', { from: from || undefined, to: to || undefined }),
  );
  const d = query.data;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-4">
        <DateBox label="Du" value={from} onChange={(v) => setPeriod((p) => ({ ...p, from: v }))} />
        <DateBox label="Au" value={to} onChange={(v) => setPeriod((p) => ({ ...p, to: v }))} />
      </div>
      {query.isError ? (
        <ErrorRetry message={errorMessage(query.error)} onRetry={() => query.refetch()} />
      ) : !d ? (
        <Skeleton aria-busy="true" aria-label="Chargement" className="h-64" />
      ) : (
        <>
          <div className="[&>div]:mb-0">
            <StatTiles
              tiles={[
                { label: "Chiffre d'affaires", value: formatMoney(d.revenue) },
                { label: 'Dépenses', value: formatMoney(d.expenses) },
                { label: 'Marge', value: formatMoney(d.margin) },
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
                      <TD className="text-right">{formatMoney(f.margin)}</TD>
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
