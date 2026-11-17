import { useId, useState } from 'react';
import { Download, FileSpreadsheet, Printer } from 'lucide-react';
import { useSearchParams } from 'react-router';
import { ApiError, api } from '../lib/api';
import { useFarmQuery } from '../lib/query';
import { ErrorRetry } from '../components/module/ErrorRetry';
import { errorMessage } from '../components/module/errorMessage';
import { LoadingBlock } from '../components/module/LoadingBlock';
import { PageHeader } from '../components/module/PageHeader';
import { panelId, tabId } from '../components/module/TabBar';
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
  const rangeError = params.from && params.to && params.from > params.to ? 'La date de début est après la date de fin' : null;
  const [fileError, setFileError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const idBase = useId();

  const types = useFarmQuery<ReportTypesDto>(['reports', 'types'], () => api.get<ReportTypesDto>('/reports'));
  const report = useFarmQuery<ReportDto>(['reports', selection.type, params], () => api.get<ReportDto>(`/reports/${selection.type}`, params), { enabled: !rangeError });

  const choose = (next: ReportSelection) => {
    const q: Record<string, string> = { type: next.type };
    for (const k of ['date', 'from', 'to'] as const) if (next[k]) q[k] = next[k]!;
    setFileError(null);
    setSearch(q, { replace: true });
  };
  const download = async (format: 'csv' | 'xlsx') => {
    if (downloading) return;
    setFileError(null);
    setDownloading(true);
    try {
      await api.download(`/reports/${selection.type}`, { ...params, format }, `rapport-${selection.type}.${format}`);
    } catch (e) {
      setFileError(errorMessage(e));
    } finally {
      setDownloading(false);
    }
  };
  const d = rangeError ? undefined : report.data;
  const showTabs = !!types.data && types.data.types.length > 1;
  const forbidden = report.error instanceof ApiError && report.error.status === 403;

  const body = rangeError ? null : report.isError ? (
    forbidden ? <Alert>{errorMessage(report.error)}</Alert> : <ErrorRetry message={errorMessage(report.error)} onRetry={() => report.refetch()} />
  ) : !d ? (
    <LoadingBlock className="h-[580px]" />
  ) : (
    <ReportView report={d} />
  );

  return (
    <div className="mx-auto w-full max-w-[1440px]">
      {/* On paper the print header of the report replaces the page header. */}
      <div className="print:hidden">
        <PageHeader
          title="Rapports"
          subtitle={d?.title}
          actions={
            <>
              <Button variant="outline" disabled={!d || downloading} onClick={() => download('csv')}>
                <Download aria-hidden className="size-4" />
                CSV
              </Button>
              <Button variant="outline" disabled={!d || downloading} onClick={() => download('xlsx')}>
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
      </div>
      {showTabs && <ReportControls idBase={idBase} rangeError={rangeError} types={types.data!.types} selection={selection} onChange={choose} />}
      {fileError && <Alert className="mb-4 print:hidden">{fileError}</Alert>}
      {showTabs ? (
        <div id={panelId(idBase, selection.type)} role="tabpanel" aria-labelledby={tabId(idBase, selection.type)}>{body}</div>
      ) : body}
    </div>
  );
}
