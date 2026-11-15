import type { Field, LineRow, OptionItem } from '../components/module/types';
import { formatMoney, formatNumber } from '../lib/format';
import { lineAmount, linesTotal } from '../lib/money';

/* ---------------------------------------------------------------------------------------------
 * API shapes of a sale line and of the sellable sources (backend contract of `/sales/sellables` and of the
 * lines of `/quotes` and `/sales`, Tasks 2–4). Reconcile with the backend here only.
 * ------------------------------------------------------------------------------------------- */

export type SaleLineKind = 'LOT' | 'ANIMAL' | 'OEUFS' | 'ARTICLE' | 'SERVICE';

/** An egg line is counted in plateaux or in single eggs. */
export type EggUnit = 'PLATEAU' | 'OEUF';

/** One source of `GET /sales/sellables?kind=&date=` → `{ items }`. A non-`sellable` one is listed with its `reason`. */
export interface Sellable {
  id: string;
  kind: Exclude<SaleLineKind, 'SERVICE'>;
  label: string;
  designation: string;
  unit: string | null;
  available: number;
  eggsPerTray?: number;
  /** `YYYY-MM-DD` */
  withdrawalUntil: string | null;
  sellable: boolean;
  reason: string | null;
}

/** A line of `GET /quotes/:id` (and of an invoice): the source is one of the three ids, by kind. */
export interface SaleLineData {
  position: number;
  kind: SaleLineKind;
  batchId: string | null;
  animalId: string | null;
  stockItemId: string | null;
  sourceLabel: string | null;
  designation: string;
  unit: string | null;
  eggsPerUnit: number | null;
  quantity: number;
  unitPrice: number;
  amount: number;
  weightKg: number | null;
}

/** The key of a line's source in the request body, by kind (a lot and an egg line both name a lot). */
const SOURCE_KEY = { LOT: 'batchId', OEUFS: 'batchId', ANIMAL: 'animalId', ARTICLE: 'stockItemId' } as const;

/* --------------------------------------------------------------------------------------------- */

export const LINE_KINDS: { value: SaleLineKind; label: string }[] = [
  { value: 'LOT', label: 'Lot' },
  { value: 'ANIMAL', label: 'Animal' },
  { value: 'OEUFS', label: 'Œufs' },
  { value: 'ARTICLE', label: 'Article' },
  { value: 'SERVICE', label: 'Prestation' },
];
export const kindLabel = (k: string) => LINE_KINDS.find((x) => x.value === k)?.label ?? k;

const EGG_UNITS: { value: EggUnit; label: string }[] = [{ value: 'PLATEAU', label: 'Plateau' }, { value: 'OEUF', label: 'Œuf' }];

/** The sources of one kind as options: one that cannot be sold stays visible, disabled, with the reason. */
const sellableOptions = (data: unknown): OptionItem[] =>
  (data as { items: Sellable[] }).items.map((s) => ({
    value: s.id,
    label: s.sellable ? s.label : `${s.label} (${s.reason ?? 'Indisponible'})`,
    disabled: !s.sellable,
    data: s,
  }));

const pick = (option: OptionItem, row: LineRow): Partial<LineRow> => {
  const source = option.data as Sellable;
  return {
    designation: source.designation,
    // Eggs are sold by the plateau unless said otherwise; an animal is one.
    ...(row.kind === 'OEUFS' ? { unit: 'PLATEAU' } : {}),
    ...(row.kind === 'ANIMAL' ? { quantity: '1' } : {}),
  };
};

/** Birds, animals and eggs are counted whole; feed and services may have decimals. */
export const isWhole = (kind: string) => kind === 'LOT' || kind === 'ANIMAL' || kind === 'OEUFS';

const rowAmount = (row: LineRow) => lineAmount(Number(row.quantity || 0), Number(row.unitPrice || 0));

/**
 * The `lines` field shared by the quote and invoice forms. `Source` is a row-dependent cell: its options are the
 * sellable sources of the row's `Type` at `date` (the document date), none for a prestation; picking one prefills
 * the designation (and the unit of eggs); no source is asked for while the date is empty. `labels` names the sources
 * already stored (id -> label), shown when they are no longer offered. The footer is the document total, round per line then sum.
 */
export function saleLinesField(date: string, labels: Record<string, string> = {}): Extract<Field, { type: 'lines' }> {
  return {
    name: 'lines',
    label: 'Lignes',
    type: 'lines',
    minRows: 1,
    addLabel: 'Ajouter une ligne',
    defaultValue: [{ kind: '', sourceId: '', designation: '', unit: '', quantity: '', unitPrice: '' }],
    columns: [
      { name: 'kind', label: 'Type', type: 'select', required: true, options: LINE_KINDS },
      {
        name: 'sourceId',
        label: 'Source',
        type: 'select',
        required: true,
        dependsOnCell: 'kind',
        // Listing the sources is a daily-entry right on ventes; without it the grid keeps what is stored.
        optionsPermission: { module: 'ventes', action: 'create' },
        options: (row) => (date && row.kind && row.kind !== 'SERVICE'
          ? { endpoint: '/sales/sellables', params: { kind: row.kind, date }, select: sellableOptions }
          : null),
        currentLabel: (row) => labels[row.sourceId],
        onPick: pick,
      },
      { name: 'designation', label: 'Désignation', type: 'text', required: true },
      { name: 'unit', label: 'Unité', type: 'select', required: true, dependsOnCell: 'kind', options: (row) => (row.kind === 'OEUFS' ? EGG_UNITS : null) },
      {
        name: 'quantity',
        label: 'Quantité',
        type: 'number',
        required: true,
        min: 0.01,
        // Birds, animals and eggs are counted whole; feed and services may have decimals.
        step: (row) => (isWhole(row.kind) ? 1 : 0.01),
        integer: (row) => isWhole(row.kind),
        integerMessage: 'La quantité doit être un nombre entier',
      },
      { name: 'unitPrice', label: 'Prix unitaire', type: 'number', required: true, min: 0, step: 0.01 },
      { name: 'amount', label: 'Total', type: 'text', computed: (row) => formatMoney(rowAmount(row)) },
    ],
    footer: (rows) => <p className="text-sm font-semibold">Total : {formatMoney(linesTotal(rows))}</p>,
  };
}

/** A line's quantity as printed and listed: eggs carry their unit (`400 plateau`, `12 œuf`), the others are bare numbers. */
export const lineQuantityLabel = (l: Pick<SaleLineData, 'kind' | 'unit' | 'quantity'>): string => {
  const unit = l.kind === 'OEUFS' ? (l.unit === 'OEUF' ? 'œuf' : 'plateau') : '';
  return unit ? `${formatNumber(l.quantity)} ${unit}` : formatNumber(l.quantity);
};

/** The rows of the form from the lines of a stored document. */
export const saleLinesToForm = (lines: SaleLineData[]): LineRow[] =>
  lines.map((l) => ({
    kind: l.kind,
    sourceId: l.batchId ?? l.animalId ?? l.stockItemId ?? '',
    designation: l.designation,
    unit: l.kind === 'OEUFS' ? (l.unit ?? '') : '',
    quantity: String(l.quantity),
    unitPrice: String(l.unitPrice),
  }));

/** The lines of the request body: the source under the key of its kind, the unit for eggs only, blank rows dropped. */
export function saleLinesToPayload(rows: LineRow[]): Record<string, unknown>[] {
  return rows
    .filter((r) => Object.values(r).some((v) => v.trim() !== ''))
    .map((r) => {
      const key = r.kind in SOURCE_KEY ? SOURCE_KEY[r.kind as keyof typeof SOURCE_KEY] : null;
      const line: Record<string, unknown> = { kind: r.kind };
      if (key && r.sourceId) line[key] = r.sourceId;
      line.designation = r.designation.trim();
      if (r.kind === 'OEUFS' && r.unit) line.unit = r.unit;
      line.quantity = Number(r.quantity);
      line.unitPrice = Number(r.unitPrice);
      return line;
    });
}

/** The label of each stored source (by id), for the sources a document names that are no longer sellable. */
export const saleLineLabels = (lines: SaleLineData[]): Record<string, string> =>
  Object.fromEntries(lines.flatMap((l) => {
    const id = l.batchId ?? l.animalId ?? l.stockItemId;
    return id ? [[id, l.sourceLabel ?? l.designation]] : [];
  }));
