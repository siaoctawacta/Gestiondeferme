import { formatDay } from '../common/days';
import { toMoney } from '../common/money';
import type { ExportColumn } from '../listing/export';
import type { Prisma } from '../generated/prisma/client';
import type {
  Activity,
  FinanceCategory,
  FinanceKind,
} from '../generated/prisma/enums';
import { ACTIVITY_LABEL, CATEGORY_LABEL } from './finance-categories';
import type { LedgerRow } from './finance-ledger';
import type { Origin } from './finance-rules';

/** One row of `GET /finance/entries` (and the answer of the manual-entry writes). */
export interface EntryItem {
  id: string;
  origin: Origin;
  sourceId: string | null;
  date: string;
  label: string;
  kind: FinanceKind;
  activity: Activity;
  category: FinanceCategory;
  /** Negative for a credit note. */
  amount: number;
  batchId: string | null;
  batchCode: string | null;
  note: string | null;
  /** The equipment of a maintenance expense (the screen links to it); absent for every other origin. */
  equipmentId?: string;
  /** Only a manual entry is edited here; a derived row is corrected in its document. */
  editable: boolean;
}

export const toEntryItem = (r: LedgerRow, equipmentId?: string): EntryItem => ({
  id: r.id,
  origin: r.origin,
  sourceId: r.sourceId,
  date: r.date,
  label: r.label,
  kind: r.kind,
  activity: r.activity,
  category: r.category,
  amount: toMoney(r.amount),
  batchId: r.batchId,
  batchCode: r.batchCode,
  note: r.note,
  ...(equipmentId ? { equipmentId } : {}),
  editable: r.origin === 'MANUEL',
});

export const entryInclude = {
  batch: { select: { code: true } },
} satisfies Prisma.FinanceEntryInclude;

export type EntryRecord = Prisma.FinanceEntryGetPayload<{
  include: typeof entryInclude;
}>;

/** A stored manual entry, in the list's shape. */
export const recordItem = (e: EntryRecord): EntryItem => ({
  id: e.id,
  origin: 'MANUEL',
  sourceId: null,
  date: formatDay(e.date),
  label: e.label,
  kind: e.kind,
  activity: e.activity,
  category: e.category,
  amount: toMoney(e.amount),
  batchId: e.batchId,
  batchCode: e.batch?.code ?? null,
  note: e.note,
  editable: true,
});

const KIND_LABEL: Record<FinanceKind, string> = {
  DEPENSE: 'Dépense',
  RECETTE: 'Recette',
};

export const ENTRY_COLUMNS: ExportColumn<EntryItem>[] = [
  { header: 'Date', date: true, value: (r) => r.date },
  { header: 'Libellé', value: (r) => r.label },
  { header: 'Type', value: (r) => KIND_LABEL[r.kind] },
  { header: 'Activité', value: (r) => ACTIVITY_LABEL[r.activity] },
  { header: 'Catégorie', value: (r) => CATEGORY_LABEL[r.category] },
  { header: 'Montant', value: (r) => r.amount },
];
