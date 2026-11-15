import type { ComponentType } from 'react';
import { ActionDialog } from '../components/module/ActionDialog';
import type { Field, ModuleConfig } from '../components/module/types';
import { Pill, type PillTone } from '../components/ui/Pill';
import { api } from '../lib/api';
import { formatMoney, formatNumber, todayIso } from '../lib/format';

/* ---------------------------------------------------------------------------------------------
 * API shapes (backend contract of `/stock`, `/stock-items`, `/stock/movements`, `/inventories`).
 * Reconcile with the backend here only.
 * ------------------------------------------------------------------------------------------- */

export type StockCategory = 'ALIMENT' | 'MEDICAMENT' | 'VACCIN' | 'MATERIEL' | 'CONSOMMABLE';
export type StockLevel = 'ok' | 'faible' | 'critique';
export type MovementType = 'ENTREE' | 'SORTIE' | 'AJUSTEMENT';
export type MovementReason = 'ACHAT' | 'CONSOMMATION' | 'TRAITEMENT' | 'INVENTAIRE' | 'PERTE' | 'AUTRE';

/** `GET /stock`: one row per active item of the organisation, with this farm's level. `id` is the stock item id. */
export interface StockRow {
  id: string;
  name: string;
  category: StockCategory;
  unit: string;
  quantity: number;
  minQty: number;
  maxQty: number | null;
  /** Absent (the list holds active items) unless the API also returns inactive ones. */
  active?: boolean;
  level: StockLevel;
  /** Whole days of stock left at the recent consumption; `null` without consumption. */
  daysOfStock: number | null;
  averageCost: number;
  value: number;
  /** `YYYY-MM-DD` of the nearest batch expiry. */
  nextExpiry: string | null;
}

/** `GET /stock/:itemId`: the row plus the batches in stock. */
export interface StockItemDetailData extends StockRow {
  batches: { id: string; lotNumber: string | null; expiryDate: string | null; receivedDate: string; quantity: number }[];
}

/** `GET /stock/movements`. `quantity` is signed (negative out). `sourceType` is set when another operation wrote it. */
export interface MovementRow {
  id: string;
  /** `YYYY-MM-DD` */
  date: string;
  itemId: string;
  itemName: string;
  type: MovementType;
  quantity: number;
  unitCost: number;
  reason: MovementReason;
  lotNumber: string | null;
  sourceType: string | null;
  note: string | null;
}

/** `GET /inventories`. */
export interface InventoryRow {
  id: string;
  /** `YYYY-MM-DD` */
  date: string;
  status: 'BROUILLON' | 'VALIDEE';
  note: string | null;
  lineCount: number;
}

/** `GET /inventories/:id`. */
export interface InventoryData extends InventoryRow {
  lines: { stockItemId: string; itemName: string; unit: string; theoreticalQty: number; countedQty: number }[];
}

/* --------------------------------------------------------------------------------------------- */

export const CATEGORIES: { value: StockCategory; label: string }[] = [
  { value: 'ALIMENT', label: 'Aliment' },
  { value: 'MEDICAMENT', label: 'Médicament' },
  { value: 'VACCIN', label: 'Vaccin' },
  { value: 'MATERIEL', label: 'Matériel' },
  { value: 'CONSOMMABLE', label: 'Consommable' },
];
export const categoryLabel = (c: string) => CATEGORIES.find((x) => x.value === c)?.label ?? c;

export const LEVELS: { value: StockLevel; label: string; tone: PillTone }[] = [
  { value: 'ok', label: 'ok', tone: 'success' },
  { value: 'faible', label: 'faible', tone: 'warning' },
  { value: 'critique', label: 'critique', tone: 'danger' },
];
export const levelPill = (level: StockLevel) => <Pill tone={LEVELS.find((l) => l.value === level)?.tone ?? 'neutral'}>{level}</Pill>;

export const MOVEMENT_TYPES: { value: MovementType; label: string; tone: PillTone }[] = [
  { value: 'ENTREE', label: 'Entrée', tone: 'success' },
  { value: 'SORTIE', label: 'Sortie', tone: 'danger' },
  { value: 'AJUSTEMENT', label: 'Ajustement', tone: 'neutral' },
];

const REASONS: { value: MovementReason; label: string }[] = [
  { value: 'ACHAT', label: 'Achat' },
  { value: 'CONSOMMATION', label: 'Consommation' },
  { value: 'TRAITEMENT', label: 'Traitement' },
  { value: 'INVENTAIRE', label: 'Inventaire' },
  { value: 'PERTE', label: 'Perte' },
  { value: 'AUTRE', label: 'Autre' },
];
/** Reasons a person may give to a manual exit. */
const EXIT_REASONS = REASONS.filter((r) => ['PERTE', 'CONSOMMATION', 'AUTRE'].includes(r.value));

/** Quantity as the movements list shows it: signed, `+` on entries. */
const signed = (n: number) => `${n > 0 ? '+' : ''}${formatNumber(n)}`;

const num = (v: unknown) => (v === '' || v === undefined ? undefined : Number(v));
type Values = Record<string, unknown>;

const quantityField: Field = { name: 'quantity', label: 'Quantité', type: 'number', required: true, min: 0.01, step: 0.01 };
const dateField: Field = { name: 'date', label: 'Date', type: 'date', required: true, defaultValue: todayIso };
const noteField: Field = { name: 'note', label: 'Note', type: 'text' };

/** The inputs of a manual movement of this type. */
function typeFields(type: MovementType): Field[] {
  switch (type) {
    case 'ENTREE':
      return [
        dateField,
        quantityField,
        { name: 'unitCost', label: 'Coût unitaire (FCFA)', type: 'number', required: true, min: 0, step: 0.01 },
        { name: 'lotNumber', label: 'N° de lot', type: 'text', only: 'create' },
        { name: 'expiryDate', label: 'Péremption', type: 'date', only: 'create' },
        noteField,
      ];
    case 'SORTIE':
      return [dateField, quantityField, { name: 'reason', label: 'Motif', type: 'select', required: true, options: EXIT_REASONS }, noteField];
    case 'AJUSTEMENT':
      return [dateField, { name: 'quantity', label: 'Écart (signé)', type: 'number', required: true, step: 0.01 }, noteField];
  }
}

export interface MovementDialogProps {
  title: string;
  /** Fixes the movement type (a row action); without it, and without `row`, the type is chosen in the form. */
  type?: MovementType;
  /** Fixes the item; without it, and without `row`, the item is chosen in the form. */
  itemId?: string;
  /** The manual movement being edited. */
  row?: MovementRow;
  onClose: () => void;
  onDone: () => void;
}

/**
 * Record or correct a manual stock movement. The API signs the quantity: an entry or exit is sent positive, an
 * adjustment signed. A refusal (`Stock insuffisant`, `Lot périmé`) shows in the dialog.
 */
export function MovementDialog({ title, type, itemId, row, onClose, onDone }: MovementDialogProps) {
  const fixed = row?.type ?? type;
  return (
    <ActionDialog
      title={title}
      mode={row ? 'update' : 'create'}
      initial={row ? { date: row.date, quantity: row.type === 'AJUSTEMENT' ? row.quantity : Math.abs(row.quantity), unitCost: row.unitCost, reason: row.reason, note: row.note } : undefined}
      fields={(values) => {
        const t = fixed ?? (values.type as MovementType | undefined);
        return [
          ...(itemId || row ? [] : [{
            name: 'stockItemId', label: 'Article', type: 'select', required: true, only: 'create',
            options: { endpoint: '/stock-items', params: { active: 'true' } },
          } as Field]),
          ...(fixed ? [] : [{
            name: 'type', label: 'Type', type: 'select', required: true, only: 'create',
            options: MOVEMENT_TYPES.map(({ value, label }) => ({ value, label })),
          } as Field]),
          ...(t ? typeFields(t) : []),
        ];
      }}
      validate={(v) => (fixed === 'AJUSTEMENT' || v.type === 'AJUSTEMENT') && Number(v.quantity) === 0 ? "L'écart ne peut pas être nul" : null}
      toPayload={(v: Values, mode) => {
        const t = fixed ?? (v.type as MovementType);
        if (mode === 'update') {
          return { date: v.date, quantity: num(v.quantity), unitCost: t === 'ENTREE' ? num(v.unitCost) : undefined, reason: t === 'SORTIE' ? v.reason : undefined, note: v.note };
        }
        return {
          stockItemId: itemId ?? v.stockItemId,
          date: v.date,
          type: t,
          quantity: num(v.quantity),
          unitCost: t === 'ENTREE' ? num(v.unitCost) : undefined,
          reason: t === 'ENTREE' ? 'ACHAT' : t === 'SORTIE' ? v.reason : 'AUTRE',
          lotNumber: v.lotNumber,
          expiryDate: v.expiryDate,
          note: v.note,
        };
      }}
      onSubmit={(body) => (row ? api.patch(`/stock/movements/${row.id}`, body) : api.post('/stock/movements', body))}
      onClose={onClose}
      onDone={onDone}
    />
  );
}

const MovementForm: ComponentType<{ row?: MovementRow; scope?: Record<string, string>; onSaved: () => void; onClose: () => void }> =
  ({ row, scope, onSaved, onClose }) => (
    <MovementDialog title={`${row ? 'Modifier' : 'Ajouter'} — Mouvements`} row={row} itemId={scope?.itemId} onClose={onClose} onDone={onSaved} />
  );

const SOURCE_LOCK = "Mouvement issu d'une autre opération";
const manualOnly = (m: MovementRow): string | true => (m.sourceType ? SOURCE_LOCK : true);

/** The `Mouvements` tab, also embedded (scoped by `itemId`) in an item's page. */
export const stockMovements: ModuleConfig<MovementRow> = {
  slug: 'stocks',
  group: 'Logistique',
  title: 'Mouvements',
  subtitle: 'Entrées, sorties et ajustements de stock.',
  endpoint: '/stock/movements',
  exportable: false,
  columns: [
    { key: 'date', header: 'DATE' },
    { key: 'itemName', header: 'ARTICLE' },
    {
      key: 'type',
      header: 'TYPE',
      render: (m) => {
        const def = MOVEMENT_TYPES.find((t) => t.value === m.type);
        return <Pill tone={def?.tone ?? 'neutral'}>{def?.label ?? m.type}</Pill>;
      },
    },
    { key: 'quantity', header: 'QUANTITÉ', render: (m) => signed(m.quantity) },
    { key: 'unitCost', header: 'COÛT UNITAIRE', render: (m) => formatMoney(m.unitCost) },
    { key: 'reason', header: 'MOTIF', render: (m) => REASONS.find((r) => r.value === m.reason)?.label ?? m.reason },
    { key: 'lotNumber', header: 'N° DE LOT', render: (m) => m.lotNumber ?? '' },
  ],
  filters: [{ param: 'type', allLabel: 'Tous les types', options: MOVEMENT_TYPES.map(({ value, label }) => ({ value, label })) }],
  rowLabel: (m) => `${m.itemName} du ${m.date}`,
  // The agent who enters a movement corrects it; one written by another operation is corrected there.
  editPermission: 'create',
  deletePermission: 'create',
  canEdit: manualOnly,
  canDelete: manualOnly,
  form: MovementForm,
};
