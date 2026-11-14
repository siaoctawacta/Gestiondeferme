import { Download, Printer } from 'lucide-react';
import { api } from '../lib/api';
import { rateOrDash, type DashboardDto } from '../lib/dashboard';
import { formatMoney, formatNumber } from '../lib/format';
import { useFarmQuery } from '../lib/query';
import { errorMessage } from '../components/module/errorMessage';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Table, TD, TH, THead, TR } from '../components/ui/Table';
import { ErrorRetry, PageTitle, Skeleton } from './PageParts';

type Row = [label: string, value: string];

function indicators(d: DashboardDto): Row[] {
  return [
    ['Volailles vivantes', formatNumber(d.kpis.poultryAlive)],
    ['Porcs (cheptel)', formatNumber(d.kpis.pigs)],
    ['Taux de mortalité (lots en cours)', rateOrDash(d.kpis.mortalityRate)],
    ['Œufs produits (dernier jour)', formatNumber(d.kpis.eggsLastDay)],
    ['Taux de ponte', rateOrDash(d.kpis.layingRate)],
    ['Aliment distribué', `${formatNumber(d.feedDistributedKg)} kg`],
    ['Eau consommée', `${formatNumber(d.waterConsumedL)} L`],
    ["Chiffre d'affaires", formatMoney(d.profitability.revenue)],
    ['Dépenses', formatMoney(d.profitability.expenses)],
    ['Marge indicative', formatMoney(d.profitability.margin)],
    ['Créances clients', formatMoney(d.profitability.receivables)],
    ['Alertes ouvertes', formatNumber(d.alerts.total)],
  ];
}

const frDate = (d: Date) =>
  `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;

const csvCell = (v: string) => `"${v.replaceAll('"', '""')}"`;

/** Downloads the indicator table: `;` separated, UTF-8 BOM so Excel reads the accents. */
function downloadCsv(rows: Row[], today: Date) {
  const lines = [['Indicateur', 'Valeur'], ...rows].map((r) => r.map(csvCell).join(';'));
  const blob = new Blob([`﻿${lines.join('\r\n')}\r\n`], { type: 'text/csv;charset=utf-8' });
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
                {rows.map(([label, value]) => (
                  <TR key={label}>
                    <TD className="px-5">{label}</TD>
                    <TD className="px-5 text-right font-semibold">{value}</TD>
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
