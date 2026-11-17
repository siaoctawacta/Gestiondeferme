import { useState } from 'react';
import { Download, FileSpreadsheet, Printer } from 'lucide-react';
import { useSearchParams } from 'react-router';
import { api } from '../lib/api';
import { useFarmQuery } from '../lib/query';
import { ErrorRetry } from '../components/module/ErrorRetry';
import { errorMessage } from '../components/module/errorMessage';
import { LoadingBlock } from '../components/module/LoadingBlock';
import { PageHeader } from '../components/module/PageHeader';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { ReportControls } from './reports/ReportControls';
import { ReportView } from './reports/ReportView';
import { isReportType, reportParams, type ReportDto, type ReportSelection, type ReportTypesDto } from './reports/reportTypes';

/** `/rapports?type=&date=&from=&to=`: the server's reports (every figure is the API's), their CSV / Excel files and print. */
export default function Reports() {
  const [search, setSearch] = useSearchParams();
  const rawType = search.get('type');
  const selection: ReportSelection = {
    type: isReportType(rawType) ? rawType : 'synthese',
    date: search.get('date') ?? undefined,
    from: search.get('from') ?? undefined,
    to: search.get('to') ?? undefined,
  };
  const params = reportParams(selection);
  const [fileError, setFileError] = useState<string | null>(null);

  const types = useFarmQuery<ReportTypesDto>(['reports', 'types'], () => api.get<ReportTypesDto>('/reports'));
  const report = useFarmQuery<ReportDto>(['reports', selection.type, params], () => api.get<ReportDto>(`/reports/${selection.type}`, params));

  const choose = (next: ReportSelection) => {
    const q: Record<string, string> = { type: next.type };
    for (const k of ['date', 'from', 'to'] as const) if (next[k]) q[k] = next[k]!;
    setSearch(q, { replace: true });
  };
  const download = async (format: 'csv' | 'xlsx') => {
    setFileError(null);
    try {
      await api.download(`/reports/${selection.type}`, { ...params, format }, `rapport-${selection.type}.${format}`);
    } catch (e) {
      setFileError(errorMessage(e));
    }
  };
  const d = report.data;

  return (
    <div className="mx-auto w-full max-w-[1440px]">
      <PageHeader
        title="Rapports"
        subtitle={d?.title}
        actions={
          <>
            <Button variant="outline" disabled={!d} onClick={() => download('csv')}>
              <Download aria-hidden className="size-4" />
              CSV
            </Button>
            <Button variant="outline" disabled={!d} onClick={() => download('xlsx')}>
              <FileSpreadsheet aria-hidden className="size-4" />
              Excel
            </Button>
            <Button disabled={!d} onClick={() => window.print()}>
              <Printer aria-hidden className="size-4" />
              Imprimer / PDF
            </Button>
          </>
        }
      />
      {types.data && types.data.types.length > 1 && <ReportControls types={types.data.types} selection={selection} onChange={choose} />}
      {fileError && <Alert className="mb-4 print:hidden">{fileError}</Alert>}
      {report.isError ? (
        <ErrorRetry message={errorMessage(report.error)} onRetry={() => report.refetch()} />
      ) : !d ? (
        <LoadingBlock className="h-[580px]" />
      ) : (
        <ReportView report={d} />
      )}
    </div>
  );
}
