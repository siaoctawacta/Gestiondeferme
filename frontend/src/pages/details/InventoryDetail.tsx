import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatDate, formatNumber, roundDecimal } from '../../lib/format';
import { farmKey, useFarmQuery } from '../../lib/query';
import { ConfirmDialog } from '../../components/module/ConfirmDialog';
import { ErrorRetry } from '../../components/module/ErrorRetry';
import { errorMessage } from '../../components/module/errorMessage';
import { validateLines } from '../../components/module/formFields';
import { LinesField, type LinesFieldDef } from '../../components/module/LinesField';
import type { LineRow } from '../../components/module/types';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { inventoryPill, type InventoryData } from '../../modules/stocksShared';
import NotFound from '../NotFound';
import { DetailLayout } from './DetailLayout';

/**
 * Gap between the count and the theoretical quantity, `null` while nothing is counted: the API's own `difference` for
 * a count as saved, the rounded local difference once the count was edited.
 */
const gapOf = (row: LineRow): number | null => {
  if ((row.countedQty ?? '') === '') return null;
  if (row.countedQty === row.savedQty && (row.difference ?? '') !== '') return Number(row.difference);
  return roundDecimal(Number(row.countedQty) - Number(row.theoreticalQty));
};

const GRID: LinesFieldDef = {
  name: 'lines',
  label: 'Comptage',
  type: 'lines',
  fixed: true,
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

/** The grid: one row per line of the session, as returned; `savedQty` / `difference` are what the API holds for the count. */
const rowsOf = (data: InventoryData): LineRow[] =>
  data.lines.map((l) => ({
    itemId: l.itemId,
    itemName: l.itemName,
    theoreticalQty: cell(l.theoreticalQty),
    countedQty: cell(l.countedQty),
    savedQty: cell(l.countedQty),
    difference: cell(l.difference),
  }));

function Sheet({ data }: { data: InventoryData }) {
  const { can, farmId } = useAuth();
  const queryClient = useQueryClient();
  const [rows, setRows] = useState(() => rowsOf(data));
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
      lines: rows.filter((r) => r.countedQty !== '').map((r) => ({ itemId: r.itemId, countedQty: Number(r.countedQty) })),
    });

  const saveDraft = async () => {
    if (!checked()) return;
    setBusy(true);
    setNotice(null);
    try {
      await save();
      setNotice({ tone: 'success', message: 'Brouillon enregistré' });
      // The save returns the counted lines only: the grid is read again, for the theoretical quantities and gaps the
      // server now holds (the notice stays, so the sheet is refreshed in place and not remounted).
      try {
        setRows(rowsOf(await api.get<InventoryData>(`/inventories/${data.id}`)));
      } catch {
        /* the refetch below shows the error state */
      }
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
        status={inventoryPill(data.status)}
        actions={
          <>
            {writable && <Button variant="outline" disabled={busy} onClick={saveDraft}>Enregistrer le brouillon</Button>}
            {canValidate && <Button disabled={busy} onClick={() => checked() && setConfirming(true)}>Valider l&apos;inventaire</Button>}
          </>
        }
        notice={notice && <Alert tone={notice.tone} className="mb-4">{notice.message}</Alert>}
      >
        <Card className="p-4">
          {draft && rows.length === 0
            ? <p className="py-6 text-center text-muted-foreground">Aucun article actif</p>
            : <LinesField field={GRID} value={rows} onChange={(r) => { setRows(r); setErrors([]); }} errors={errors} disabled={!writable} />}
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
 * `/m/stocks/inv-:id`: one count session. A draft is a grid over the lines the API returns (every active article with
 * its theoretical quantity; counts typed in, saved as a draft, then validated: the gaps become adjustments); a
 * validated session is read-only.
 */
export function InventoryDetail({ id }: { id: string }) {
  const session = useFarmQuery<InventoryData>(['/inventories', 'detail', id], () => api.get<InventoryData>(`/inventories/${id}`));

  if (session.isPending) return <div aria-busy className="h-40 animate-pulse rounded-3xl bg-muted" />;
  if (session.isError) {
    if (session.error instanceof ApiError && (session.error.status === 404 || session.error.status === 400)) return <NotFound />;
    return <ErrorRetry message={errorMessage(session.error)} onRetry={() => session.refetch()} />;
  }

  // Remount on a refetch (a validation), so the grid shows what the server now holds.
  return <Sheet key={session.data.status} data={session.data} />;
}
