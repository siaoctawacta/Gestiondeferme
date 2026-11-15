import { Download, Printer } from 'lucide-react';
import { api } from '../lib/api';
import { rateOrDash, type DashboardDto } from '../lib/dashboard';
import { saveBlob } from '../lib/api';
import { formatDate, formatDateFr, formatMoney, formatNumber } from '../lib/format';
import { useFarmQuery } from '../lib/query';
import { ErrorRetry } from '../components/module/ErrorRetry';
import { errorMessage } from '../components/module/errorMessage';
import { PageHeader } from '../components/module/PageHeader';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Table, TD, TH, THead, TR } from '../components/ui/Table';
import { ActivityCards } from '../modules/financeShared';
import { buildCsv, type IndicatorRow } from './reportCsv';
import { Skeleton } from './PageParts';

function indicators(d: DashboardDto): IndicatorRow[] {
  const num = (label: string, value: number, unit = ''): IndicatorRow => ({
    label, display: unit === 'FCFA' ? formatMoney(value) : `${formatNumber(value)}${unit ? ` ${unit}` : ''}`, value, unit,
  });
  const rate = (label: string, value: number | null): IndicatorRow => ({
    label, display: rateOrDash(value), value, unit: '%',
  });
  // A role without finance access gets no financial row (the API sends `null`), never a zero.
  const p = d.profitability;
  const finance: IndicatorRow[] = p
    ? [
        num("Chiffre d'affaires", p.revenue, 'FCFA'),
        num('Dépenses', p.expenses, 'FCFA'),
        num('Marge indicative', p.margin, 'FCFA'),
        num('Créances clients', p.receivables, 'FCFA'),
      ]
    : [];
  return [
    num('Volailles vivantes', d.kpis.poultryAlive),
    num('Porcs (cheptel)', d.kpis.pigs),
    rate('Taux de mortalité (lots en cours)', d.kpis.mortalityRate),
    num('Œufs produits (dernier jour)', d.kpis.eggsLastDay),
    rate('Taux de ponte', d.kpis.layingRate),
    num('Aliment distribué', d.feedDistributedKg, 'kg'),
    num('Eau consommée', d.waterConsumedL, 'L'),
    ...finance,
    num('Alertes ouvertes', d.alerts.total),
  ];
}

function downloadCsv(rows: IndicatorRow[], today: Date) {
  saveBlob(new Blob([buildCsv(rows)], { type: 'text/csv;charset=utf-8' }), `rapport-${formatDate(today)}.csv`);
}

export default function Reports() {
  const query = useFarmQuery<DashboardDto>(['dashboard'], () => api.get<DashboardDto>('/dashboard'));
  const d = query.data;
  const today = new Date();
  const rows = d ? indicators(d) : [];

  return (
    <div className="mx-auto w-full max-w-[1440px]">
      <PageHeader
        title="Rapports"
        subtitle={`Synthèse au ${formatDateFr(today)}`}
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
          {d.revenueVsExpenses && <ActivityCards rows={d.revenueVsExpenses} />}
        </div>
      )}
    </div>
  );
}
