import { Card } from '../../components/ui/Card';
import { Table, TD, TH, THead, TR } from '../../components/ui/Table';
import { formatDateTime, formatDecimal, formatNumber, formatPct, formatMoney, orDash, signedMoney } from '../../lib/format';
import { ActivityCards } from '../../modules/financeShared';
import { useLegal } from '../print/SheetFrame';
import '../../styles/print-report.css';
import type { ReportDto, ReportUnit } from './reportTypes';

/** A report value by unit; `—` when the API has none. */
export function formatReportValue(value: number | null, unit: ReportUnit | undefined): string {
  return orDash(value, (n) => {
    switch (unit) {
      case 'FCFA': return signedMoney(n);
      case '%': return formatPct(n);
      case 'kg': case 'L': case 'j': case 'g': return `${formatDecimal(n, 2)} ${unit}`;
      default: return formatNumber(n);
    }
  });
}

function cell(value: string | number | null | undefined, unit: ReportUnit | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'string') return value;
  return unit === 'FCFA' ? formatMoney(value) : formatReportValue(value, unit);
}

/** Header printed on paper only: legal name, report title, generation time. */
function PrintHeader({ report }: { report: ReportDto }) {
  const { legal } = useLegal();
  return (
    <header className="report-print-header hidden border-b border-border pb-3 print:block">
      <p className="text-lg font-bold">{legal?.name || report.farmName}</p>
      <p className="text-xl font-bold">{report.title}</p>
      <p className="text-sm">Généré le {formatDateTime(report.generatedAt).replace(' ', ' à ')}</p>
    </header>
  );
}

/** The sections of a report, in the API's order. The synthèse carries no section titles (the reference has none). */
export function ReportView({ report }: { report: ReportDto }) {
  const titled = report.type !== 'synthese';
  return (
    <div className="report space-y-6">
      <PrintHeader report={report} />
      {report.sections.map((s) => (
        <section key={s.key} aria-label={s.title} className="report-section space-y-4">
          {titled && <h2 className="text-xl font-bold">{s.title}</h2>}
          {s.rows && (
            <Card className="overflow-hidden">
              <Table>
                <THead>
                  <TR>
                    <TH className="px-5">Indicateur</TH>
                    <TH className="px-5 text-right">Valeur</TH>
                  </TR>
                </THead>
                <tbody>
                  {s.rows.map((r) => (
                    <TR key={r.key}>
                      <TD className="px-5">{r.label}</TD>
                      <TD className="px-5 text-right font-semibold">{formatReportValue(r.value, r.unit)}</TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            </Card>
          )}
          {s.cards && <ActivityCards rows={s.cards} />}
          {s.table && (
            <Card className="overflow-hidden">
              <Table>
                <THead>
                  <TR>{s.table.columns.map((c) => <TH key={c.key} className="px-5">{c.header}</TH>)}</TR>
                </THead>
                <tbody>
                  {s.table.rows.map((row, i) => (
                    <TR key={i}>
                      {s.table!.columns.map((c) => (
                        <TD key={c.key} className={`px-5 ${typeof row[c.key] === 'number' ? 'text-right' : ''}`}>
                          {cell(row[c.key], c.unit)}
                        </TD>
                      ))}
                    </TR>
                  ))}
                </tbody>
              </Table>
            </Card>
          )}
        </section>
      ))}
    </div>
  );
}
