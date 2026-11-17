import { useState } from 'react';
import { ActionDialog } from '../components/module/ActionDialog';
import type { Field, ModuleConfig } from '../components/module/types';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDate, todayIso } from '../lib/format';
import { periodError } from '../pages/finance/period';
import { FinanceSummary } from '../pages/finance/FinanceSummary';
import { LotProfitabilityTab } from '../pages/finance/LotProfitability';
import {
  ACTIVITIES, AmountPill, EntryLabel, PayrollPicker, usePayrollPicker, EXPENSE_CATEGORIES, KINDS, REVENUE_CATEGORIES, activityLabel, categoriesOf, categoryLabel, entryKindLabel, lockedReason,
  type FinanceEntryRow,
} from './financeShared';

/** The activities whose expenses may be attributed to a lot. */
const LOT_ACTIVITIES = ['AVICOLE', 'PORCIN'];

/** `GET /finance/lot-options?activity=` (finance read only): the open lots of that activity on the active farm. */
const lotOptions = {
  endpoint: '/finance/lot-options',
  select: (data: unknown) => ((data as { items: { id: string; label: string }[] }).items ?? []).map((l) => ({ value: l.id, label: l.label })),
};

const toForm = (r: FinanceEntryRow) => ({
  date: r.date,
  kind: r.kind,
  label: r.label,
  activity: r.activity,
  category: r.category,
  amount: r.amount,
  batchId: r.batchId ?? '',
  note: r.note ?? '',
});

/**
 * The add / edit dialog of a manual entry. `Catégorie` follows `Type` (expense or revenue categories); `Lot` is offered
 * for an expense of the poultry or pig activity only, from the finance endpoint (no stock of species rights needed). A
 * category chosen under another Type and a lot chosen under another activity are cleared (`dependsOn`); the lot is only
 * sent for an expense of those activities, and an edit that no longer qualifies sends `batchId: null`.
 */
function FinanceForm({ row, onSaved, onClose }: { row?: FinanceEntryRow; onSaved: () => void; onClose: () => void }) {
  const { can } = useAuth();
  // `Salaires du mois` hands over the entry's initial values; the dialog restarts from them (`key`).
  const [prefill, setPrefill] = useState<{ values: Record<string, unknown>; n: number } | null>(null);
  const picker = usePayrollPicker((values) => setPrefill((p) => ({ values, n: (p?.n ?? 0) + 1 })));
  const hasLot = (values: Record<string, unknown>) => values.kind === 'DEPENSE' && LOT_ACTIVITIES.includes(String(values.activity));
  const fields = (values: Record<string, unknown>): Field[] => [
    { name: 'date', label: 'Date', type: 'date', required: true, defaultValue: todayIso },
    { name: 'kind', label: 'Type', type: 'segmented', required: true, defaultValue: 'DEPENSE', options: KINDS },
    { name: 'label', label: 'Libellé', type: 'text', required: true },
    { name: 'activity', label: 'Activité', type: 'select', required: true, options: ACTIVITIES },
    { name: 'category', label: 'Catégorie', type: 'select', required: true, dependsOn: 'kind', options: categoriesOf(String(values.kind)) },
    { name: 'amount', label: 'Montant', type: 'number', required: true, min: 0.01, step: 0.01 },
    ...(hasLot(values) ? ([{ name: 'batchId', label: 'Lot', type: 'select', dependsOn: 'activity', options: lotOptions }] as Field[]) : []),
    { name: 'note', label: 'Note', type: 'textarea' },
  ];
  return (
    <ActionDialog
      key={prefill?.n ?? 0}
      title={`${row ? 'Modifier' : 'Ajouter'} — Dépenses & recettes`}
      mode={row ? 'update' : 'create'}
      fields={fields}
      intro={!row && can('finance', 'create') ? <PayrollPicker picker={picker} /> : undefined}
      initial={row ? toForm(row) : prefill?.values}
      toPayload={(v) => {
        // A hidden `Lot` is absent from the values: the stored one is kept while kind and activity are the stored ones
        // (the comparison base of an edit), and cleared (`''`, sent as null) once they change.
        const unchanged = row !== undefined && v.kind === row.kind && v.activity === row.activity;
        const batchId = v.batchId ?? (unchanged ? row.batchId : undefined) ?? '';
        return {
          date: v.date, kind: v.kind, label: v.label, activity: v.activity, category: v.category,
          amount: v.amount === '' ? '' : Number(v.amount), batchId: hasLot(v) || unchanged ? batchId : '', note: v.note,
        };
      }}
      onSubmit={(body) => (row ? api.patch(`/finance/entries/${row.id}`, body) : api.post('/finance/entries', body))}
      onClose={onClose}
      onDone={onSaved}
    />
  );
}

/**
 * `Finance` as `m_finance.png`: every recette and dépense of the farm, manual or derived (from purchases, lot purchase
 * prices, invoices and credit notes), with the `Synthèse` and `Rentabilité par lot` tabs. A manual entry is a daily
 * entry (`create` on `finance`); a derived row is locked with its reason and links to its document.
 */
export const finance: ModuleConfig<FinanceEntryRow> = {
  slug: 'finance',
  group: 'Finance',
  title: 'Dépenses & recettes',
  subtitle: 'Recettes, dépenses, coûts et rentabilité par activité.',
  endpoint: '/finance/entries',
  columns: [
    { key: 'date', header: 'DATE', render: (r) => formatDate(r.date), sortable: true },
    { key: 'label', header: 'LIBELLÉ', render: (r) => <EntryLabel row={r} /> },
    { key: 'kind', header: 'TYPE', render: (r) => entryKindLabel(r.kind) },
    { key: 'activity', header: 'ACTIVITÉ', render: (r) => activityLabel(r.activity) },
    { key: 'category', header: 'CATÉGORIE', render: (r) => categoryLabel(r.category) },
    { key: 'amount', header: 'MONTANT', render: (r) => <AmountPill row={r} />, sortable: true },
  ],
  filters: [
    { param: 'from', allLabel: 'Du', type: 'date' },
    { param: 'to', allLabel: 'Au', type: 'date' },
    { param: 'kind', allLabel: 'Tous les types', options: KINDS },
    { param: 'activity', allLabel: 'Toutes les activités', options: ACTIVITIES },
    { param: 'category', allLabel: 'Toutes les catégories', options: [...EXPENSE_CATEGORIES, ...REVENUE_CATEGORIES] },
  ],
  // The period is shared by the three tabs; the entries list opens on all dates (no period), `Synthèse` fills in the month to date.
  sharedFilters: { params: ['from', 'to'], defaults: () => ({ from: '', to: '' }), validate: periodError },
  form: FinanceForm,
  rowLabel: (r) => r.label,
  // A manual entry is a daily entry: whoever may enter it (`create`) corrects and withdraws it.
  editPermission: 'create',
  deletePermission: 'create',
  canEdit: lockedReason,
  canDelete: lockedReason,
  tabs: [
    { key: 'synthese', label: 'Synthèse', element: <FinanceSummary /> },
    { key: 'lots', label: 'Rentabilité par lot', element: <LotProfitabilityTab /> },
  ],
};
