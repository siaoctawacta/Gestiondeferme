import { Download, Printer } from 'lucide-react';
import { api } from '../lib/api';
import { rateOrDash, type DashboardDto } from '../lib/dashboard';
import { formatMoney, formatNumber } from '../lib/format';
import { useFarmQuery } from '../lib/query';
import { errorMessage } from '../components/module/errorMessage';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Table, TD, TH, THead, TR } from '../components/ui/Table';
import { buildCsv, type IndicatorRow } from './reportCsv';
import { ErrorRetry, PageTitle, Skeleton } from './PageParts';

function indicators(d: DashboardDto): IndicatorRow[] {
  const num = (label: string, value: number, unit = ''): IndicatorRow => ({
    label, display: unit === 'FCFA' ? formatMoney(value) : `${formatNumber(value)}${unit ? ` ${unit}` : ''}`, value, unit,
  });
  const rate = (label: string, value: number | null): IndicatorRow => ({
    label, display: rateOrDash(value), value, unit: '%',
  });
  return [
    num('Volailles vivantes', d.kpis.poultryAlive),
    num('Porcs (cheptel)', d.kpis.pigs),
    rate('Taux de mortalité (lots en cours)', d.kpis.mortalityRate),
    num('Œufs produits (dernier jour)', d.kpis.eggsLastDay),
    rate('Taux de ponte', d.kpis.layingRate),
    num('Aliment distribué', d.feedDistributedKg, 'kg'),
    num('Eau consommée', d.waterConsumedL, 'L'),
    num("Chiffre d'affaires", d.profitability.revenue, 'FCFA'),
    num('Dépenses', d.profitability.expenses, 'FCFA'),
    num('Marge indicative', d.profitability.margin, 'FCFA'),
    num('Créances clients', d.profitability.receivables, 'FCFA'),
    num('Alertes ouvertes', d.alerts.total),
  ];
}

const frDate = (d: Date) =>
  `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;

function downloadCsv(rows: IndicatorRow[], today: Date) {
  const blob = new Blob([buildCsv(rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `rapport-${today.toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function Reports() {
  const query = useFarmQuery<DashboardDto>(['dashboard'], () => api.get<DashboardDto>('/dashboard'));
  const d = query.data;
  const today = new Date();
  const rows = d ? indicators(d) : [];

  return (
    <div className="mx-auto w-full max-w-[1440px]">
      <PageTitle
        title="Rapports"
        subtitle={`Synthèse au ${frDate(today)}`}
        actions={
          <>
            <Button variant="outline" disabled={!d} onClick={() => downloadCsv(rows, today)}>
              <Download aria-hidden className="size-4" />
              CSV
            </Button>
            <Button disabled={!d} onClick={() => window.print()}>
              <Printer aria-hidden className="size-4" />
              Imprimer / PDF
            </Button>
          </>
        }
      />
      {query.isError ? (
        <ErrorRetry message={errorMessage(query.error)} onRetry={() => query.refetch()} />
      ) : !d ? (
        <div aria-busy="true" aria-label="Chargement" className="space-y-6">
          <Skeleton className="h-[580px]" />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-28" />)}</div>
        </div>
      ) : (
        <div className="space-y-6">
          <Card className="overflow-hidden">
            <Table>
              <THead>
                <TR>
                  <TH className="px-5">Indicateur</TH>
                  <TH className="px-5 text-right">Valeur</TH>
                </TR>
              </THead>
              <tbody>
                {rows.map((r) => (
                  <TR key={r.label}>
                    <TD className="px-5">{r.label}</TD>
                    <TD className="px-5 text-right font-semibold">{r.display}</TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          </Card>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {d.revenueVsExpenses.map((a) => (
              <Card key={a.activity} className="p-5">
                <p className="text-sm text-muted-foreground">Activité {a.activity}</p>
                <p className="mt-2 font-display text-[28px] font-bold leading-9">{formatMoney(a.revenue - a.expenses)}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Recettes {formatMoney(a.revenue)} · Dépenses {formatMoney(a.expenses)}
                </p>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
