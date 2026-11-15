import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatDate, formatNumber } from '../../lib/format';
import { farmKey, useFarmQuery } from '../../lib/query';
import { allPages } from '../../components/module/allPages';
import { ConfirmDialog } from '../../components/module/ConfirmDialog';
import { ErrorRetry } from '../../components/module/ErrorRetry';
import { errorMessage } from '../../components/module/errorMessage';
import { validateLines } from '../../components/module/formFields';
import { LinesField, type LinesFieldDef } from '../../components/module/LinesField';
import type { LineRow } from '../../components/module/types';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Pill } from '../../components/ui/Pill';
import type { InventoryData, StockRow } from '../../modules/stocksShared';
import NotFound from '../NotFound';
import { DetailLayout } from './DetailLayout';

/** Gap between the count and the theoretical quantity, `null` while nothing is counted. */
const gapOf = (row: LineRow): number | null =>
  (row.countedQty ?? '') === '' ? null : Number(row.countedQty) - Number(row.theoreticalQty);

const GRID: LinesFieldDef = {
  name: 'lines',
  label: 'Comptage',
  type: 'lines',
  columns: [
    { name: 'itemName', label: 'Article', type: 'text', readOnly: true },
    { name: 'theoreticalQty', label: 'Théorique', type: 'number', readOnly: true },
    { name: 'countedQty', label: 'Compté', type: 'number', min: 0, step: 0.01 },
    {
      name: 'gap',
      label: 'Écart',
      type: 'number',
      computed: (row) => {
        const gap = gapOf(row);
        if (gap === null) return '—';
        // The sign is in the text, the colour only reinforces it.
        const text = gap > 0 ? `+${formatNumber(gap)}` : gap < 0 ? `−${formatNumber(-gap)}` : '0';
        return <span className={gap < 0 ? 'text-destructive' : gap > 0 ? 'text-accent-foreground' : ''}>{text}</span>;
      },
    },
  ],
};

const cell = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n));

/** A draft lists every active item: the counts already saved, the others at the current level. */
function draftRows(data: InventoryData, stock: StockRow[]): LineRow[] {
  const saved = new Map(data.lines.map((l) => [l.stockItemId, l]));
  return stock.map((s) => {
    const line = saved.get(s.id);
    return {
      stockItemId: s.id,
      itemName: s.name,
      theoreticalQty: cell(line ? line.theoreticalQty : s.quantity),
      countedQty: cell(line?.countedQty),
    };
  });
}

const savedRows = (data: InventoryData): LineRow[] =>
  data.lines.map((l) => ({
    stockItemId: l.stockItemId,
    itemName: l.itemName,
    theoreticalQty: cell(l.theoreticalQty),
    countedQty: cell(l.countedQty),
  }));

function Sheet({ data, initial }: { data: InventoryData; initial: LineRow[] }) {
  const { can, farmId } = useAuth();
  const queryClient = useQueryClient();
  const [rows, setRows] = useState(initial);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const draft = data.status === 'BROUILLON';
  const writable = draft && can('stocks', 'create') && farmId !== 'all';
  const canValidate = draft && can('stocks', 'validate') && farmId !== 'all';
  const refresh = () => void queryClient.invalidateQueries({ queryKey: farmKey(farmId) });

  const [errors, setErrors] = useState<string[]>([]);
  /** Count errors (a negative count) shown under the grid; true when the sheet can be sent. */
  const checked = () => {
    const found = validateLines(GRID, rows);
    setErrors(found);
    return found.length === 0;
  };

  const save = () =>
    api.put(`/inventories/${data.id}/lines`, {
      lines: rows.filter((r) => r.countedQty !== '').map((r) => ({ stockItemId: r.stockItemId, countedQty: Number(r.countedQty) })),
    });

  const saveDraft = async () => {
    if (!checked()) return;
    setBusy(true);
    setNotice(null);
    try {
      await save();
      setNotice({ tone: 'success', message: 'Brouillon enregistré' });
      refresh();
    } catch (e) {
      setNotice({ tone: 'error', message: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <DetailLayout
        back={{ to: '/m/stocks', label: 'Stocks' }}
        title={`Inventaire du ${formatDate(data.date)}`}
        subtitle={data.note ?? undefined}
        status={<Pill tone={draft ? 'warning' : 'success'}>{draft ? 'Brouillon' : 'Validée'}</Pill>}
        actions={
          <>
            {writable && <Button variant="outline" disabled={busy} onClick={saveDraft}>Enregistrer le brouillon</Button>}
            {canValidate && <Button disabled={busy} onClick={() => checked() && setConfirming(true)}>Valider l&apos;inventaire</Button>}
          </>
        }
        notice={notice && <Alert tone={notice.tone} className="mb-4">{notice.message}</Alert>}
      >
        <Card className="p-4">
          <LinesField field={GRID} value={rows} onChange={(r) => { setRows(r); setErrors([]); }} errors={errors} fixed disabled={!writable} />
        </Card>
      </DetailLayout>
      {confirming && (
        <ConfirmDialog
          title="Valider l'inventaire"
          message={`Valider l'inventaire du ${formatDate(data.date)} ? Les écarts seront enregistrés comme ajustements. Les articles non comptés sont ignorés.`}
          confirmLabel="Valider"
          onClose={() => setConfirming(false)}
          onConfirm={async () => {
            // The counts on screen are the ones validated.
            await save();
            await api.post(`/inventories/${data.id}/validate`);
            setConfirming(false);
            refresh();
          }}
        />
      )}
    </>
  );
}

/**
 * `/m/stocks/inv-:id`: one count session. A draft is a grid over every active item (counts typed in, saved as a
 * draft, then validated: the gaps become adjustments); a validated session is read-only.
 */
export function InventoryDetail({ id }: { id: string }) {
  const session = useFarmQuery<InventoryData>(['/inventories', 'detail', id], () => api.get<InventoryData>(`/inventories/${id}`));
  const draft = session.data?.status === 'BROUILLON';
  const stock = useFarmQuery<StockRow[]>(['/stock', 'all'], () => allPages<StockRow>('/stock'), { enabled: draft });

  if (session.isPending || (draft && stock.isPending && !stock.isError)) return <div aria-busy className="h-40 animate-pulse rounded-3xl bg-muted" />;
  if (session.isError) {
    if (session.error instanceof ApiError && (session.error.status === 404 || session.error.status === 400)) return <NotFound />;
    return <ErrorRetry message={errorMessage(session.error)} onRetry={() => session.refetch()} />;
  }
  if (draft && stock.isError) return <ErrorRetry message={errorMessage(stock.error)} onRetry={() => stock.refetch()} />;

  const data = session.data;
  // Remount on a refetch (a validation), so the grid shows what the server now holds.
  return <Sheet key={data.status} data={data} initial={draft ? draftRows(data, stock.data ?? []) : savedRows(data)} />;
}
