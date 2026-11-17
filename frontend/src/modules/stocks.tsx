import { useRef, type ComponentType } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowDownToLine, ArrowUpFromLine, SlidersHorizontal } from 'lucide-react';
import { ActionDialog } from '../components/module/ActionDialog';
import type { ModuleConfig, RowAction } from '../components/module/types';
import { errorMessage } from '../components/module/errorMessage';
import { ApiError, api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { farmKey } from '../lib/query';
import { formatNumber, orDash, todayIso } from '../lib/format';
import {
  CATEGORIES, LEVELS, MovementDialog, categoryLabel, inventoryPill, levelPill, stockMovements,
  type InventoryRow, type StockRow,
} from './stocksShared';
import { lazyRetry } from '../components/lazyRetry';

// Loaded when the page opens, so the main bundle does not hold it (the config itself stays eager: the registry needs it).
const InventoryDetail = lazyRetry(() => import('../pages/details/InventoryDetail').then((m) => ({ default: m.InventoryDetail })));
const StockItemDetail = lazyRetry(() => import('../pages/details/StockItemDetail').then((m) => ({ default: m.StockItemDetail })));

type RowDialogProps = { row: StockRow; onClose: () => void; onDone: () => void };

const INVENTORY_PREFIX = 'inv-';

/** `/m/stocks/:id`: an item, or `inv-{id}` for a count session. */
function StockDetail({ id }: { id: string }) {
  return id.startsWith(INVENTORY_PREFIX) ? <InventoryDetail id={id.slice(INVENTORY_PREFIX.length)} /> : <StockItemDetail id={id} />;
}

/**
 * Add / edit an item. The item is organisation data (`/stock-items`), the thresholds belong to the active farm
 * (`PUT /stock/:id/thresholds`): adding makes both calls, editing sends each only when something of it changed.
 * Once the item exists its id is kept for the life of the dialog: a retry after a failed thresholds call redoes
 * only the thresholds (a second POST would be a 409), and the list is refreshed as soon as the item exists.
 */
function StockItemForm({ row, onSaved, onClose }: { row?: StockRow; onSaved: () => void; onClose: () => void }) {
  const { farmId } = useAuth();
  const queryClient = useQueryClient();
  const created = useRef<string | null>(null);
  return (
    <ActionDialog
      title={`${row ? 'Modifier' : 'Ajouter'} — Stocks`}
      mode={row ? 'update' : 'create'}
      // The list only holds active items unless the API says otherwise.
      initial={row ? { ...row, active: row.active ?? true } : undefined}
      fields={[
        { name: 'name', label: 'Nom', type: 'text', required: true },
        { name: 'category', label: 'Catégorie', type: 'select', required: true, options: CATEGORIES },
        { name: 'unit', label: 'Unité', type: 'text', required: true },
        { name: 'minQty', label: 'Seuil minimum', type: 'number', required: true, min: 0, step: 0.01 },
        { name: 'maxQty', label: 'Seuil maximum', type: 'number', min: 0, step: 0.01 },
        { name: 'active', label: 'Actif', type: 'checkbox', defaultValue: true },
      ]}
      onSubmit={async (body) => {
        const { minQty, maxQty, ...item } = body as Record<string, unknown>;
        if (!row) {
          if (!created.current) {
            created.current = (await api.post<{ id: string }>('/stock-items', item)).id;
            void queryClient.invalidateQueries({ queryKey: farmKey(farmId) });
          }
          try {
            await api.put(`/stock/${created.current}/thresholds`, { minQty, ...(maxQty === undefined ? {} : { maxQty }) });
          } catch (e) {
            throw new ApiError(e instanceof ApiError ? e.status : 0, `Article créé, mais les seuils n'ont pas été enregistrés : ${errorMessage(e)}`);
          }
          return;
        }
        if (Object.keys(item).length > 0) await api.patch(`/stock-items/${row.id}`, item);
        if (minQty !== undefined || maxQty !== undefined) {
          await api.put(`/stock/${row.id}/thresholds`, {
            minQty: minQty ?? row.minQty,
            maxQty: maxQty === undefined ? (row.maxQty ?? undefined) : maxQty,
          });
        }
      }}
      onClose={onClose}
      onDone={onSaved}
    />
  );
}

const EntryDialog = ({ row, onClose, onDone }: RowDialogProps) => (
  <MovementDialog title={`Entrée — ${row.name}`} type="ENTREE" itemId={row.id} onClose={onClose} onDone={onDone} />
);
const ExitDialog = ({ row, onClose, onDone }: RowDialogProps) => (
  <MovementDialog title={`Sortie — ${row.name}`} type="SORTIE" itemId={row.id} onClose={onClose} onDone={onDone} />
);
const AdjustmentDialog = ({ row, onClose, onDone }: RowDialogProps) => (
  <MovementDialog title={`Ajustement — ${row.name}`} type="AJUSTEMENT" itemId={row.id} onClose={onClose} onDone={onDone} />
);

/** Daily movements: whoever may enter them (`create`) sees the three buttons. */
const movementAction = (key: string, label: string, icon: RowAction<StockRow>['icon'], dialog: ComponentType<RowDialogProps>): RowAction<StockRow> => ({
  key, label, icon, permission: 'create', dialog,
});

/** The `Inventaires` tab: count sessions; opening one goes to its page. */
const inventories: ModuleConfig<InventoryRow> = {
  slug: 'stocks',
  group: 'Logistique',
  title: 'Inventaires',
  subtitle: 'Comptages physiques et ajustements.',
  endpoint: '/inventories',
  columns: [
    { key: 'date', header: 'DATE' },
    { key: 'status', header: 'STATUT', render: (r) => inventoryPill(r.status) },
    { key: 'lineCount', header: 'LIGNES COMPTÉES', render: (r) => formatNumber(r.lineCount) },
    { key: 'note', header: 'NOTE', render: (r) => r.note ?? '' },
  ],
  fields: [
    { name: 'date', label: 'Date', type: 'date', required: true, defaultValue: todayIso },
    { name: 'note', label: 'Note', type: 'text' },
  ],
  rowLabel: (r) => `Inventaire du ${r.date}`,
  detailPath: (r) => `/m/stocks/${INVENTORY_PREFIX}${r.id}`,
  // A session is counted on its page, never edited here; only a draft can be deleted, by whoever may count (the API's daily rule).
  canEdit: () => false,
  deletePermission: 'create',
  canDelete: (r) => (r.status === 'VALIDEE' ? 'Inventaire validé' : true),
};

export const stocks: ModuleConfig<StockRow> = {
  slug: 'stocks',
  group: 'Logistique',
  title: 'Stocks',
  tabLabel: 'Stocks',
  subtitle: 'Aliments, médicaments, matériel et consommables.',
  endpoint: '/stock',
  columns: [
    { key: 'name', header: 'ARTICLE' },
    { key: 'category', header: 'CATÉGORIE', render: (s) => categoryLabel(s.category) },
    { key: 'quantity', header: 'QUANTITÉ', render: (s) => formatNumber(s.quantity) },
    { key: 'unit', header: 'UNITÉ' },
    { key: 'minQty', header: 'SEUIL MINIMUM', render: (s) => formatNumber(s.minQty) },
    { key: 'level', header: 'NIVEAU', render: (s) => levelPill(s.level) },
    { key: 'daysOfStock', header: 'JOURS DE STOCK', render: (s) => orDash(s.daysOfStock) },
  ],
  filters: [
    { param: 'level', allLabel: 'Tous les niveaux', options: LEVELS.map(({ value, label }) => ({ value, label })) },
    { param: 'category', allLabel: 'Toutes les catégories', options: CATEGORIES },
  ],
  // Items are organisation data whose thresholds are per farm: master rights, like the other catalogues.
  createPermission: 'update',
  form: StockItemForm,
  deletePath: (s) => `/stock-items/${s.id}`,
  detail: StockDetail,
  qr: 'article',
  actions: [
    movementAction('entree', 'Entrée', ArrowDownToLine, EntryDialog),
    movementAction('sortie', 'Sortie', ArrowUpFromLine, ExitDialog),
    movementAction('ajustement', 'Ajustement', SlidersHorizontal, AdjustmentDialog),
  ],
  tabs: [
    { key: 'mouvements', label: 'Mouvements', config: stockMovements },
    { key: 'inventaires', label: 'Inventaires', config: inventories },
  ],
};
