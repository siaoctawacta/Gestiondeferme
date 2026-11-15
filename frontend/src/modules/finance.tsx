import { ActionDialog } from '../components/module/ActionDialog';
import type { Field, ModuleConfig } from '../components/module/types';
import { useEndpointOptions } from '../components/module/useEndpointOptions';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDate, todayIso } from '../lib/format';
import { FinanceSummary } from '../pages/finance/FinanceSummary';
import { LotProfitabilityTab } from '../pages/finance/LotProfitability';
import {
  ACTIVITIES, AmountPill, EntryLabel, EXPENSE_CATEGORIES, KINDS, REVENUE_CATEGORIES, activityLabel, categoriesOf, categoryLabel, kindLabel, lockedReason,
  type FinanceEntryRow,
} from './financeShared';
import { SPECIES_MODULE, openLotOptions, type Species } from './productionShared';

const SPECIES_OF: Record<string, Species | undefined> = { AVICOLE: 'AVICOLE', PORCIN: 'PORCIN' };

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
 * for an expense of the poultry or pig activity only, and lists that species' open lots. A lot or a category chosen under
 * another parent value is cleared (`dependsOn`).
 */
function FinanceForm({ row, onSaved, onClose }: { row?: FinanceEntryRow; onSaved: () => void; onClose: () => void }) {
  const { can } = useAuth();
  const lots = {
    AVICOLE: useEndpointOptions(openLotOptions('AVICOLE'), undefined, can(SPECIES_MODULE.AVICOLE, 'read')),
    PORCIN: useEndpointOptions(openLotOptions('PORCIN'), undefined, can(SPECIES_MODULE.PORCIN, 'read')),
  };
  const fields = (values: Record<string, unknown>): Field[] => {
    const species = values.kind === 'DEPENSE' ? SPECIES_OF[String(values.activity)] : undefined;
    return [
      { name: 'date', label: 'Date', type: 'date', required: true, defaultValue: todayIso },
      { name: 'kind', label: 'Type', type: 'segmented', required: true, defaultValue: 'DEPENSE', options: KINDS },
      { name: 'label', label: 'Libellé', type: 'text', required: true },
      { name: 'activity', label: 'Activité', type: 'select', required: true, options: ACTIVITIES },
      {
        name: 'category', label: 'Catégorie', type: 'select', required: true, dependsOn: 'kind',
        options: categoriesOf(String(values.kind)),
      },
      { name: 'amount', label: 'Montant', type: 'number', required: true, min: 0.01, step: 0.01 },
      ...(species && can(SPECIES_MODULE[species], 'read')
        ? ([{ name: 'batchId', label: 'Lot', type: 'select', dependsOn: 'activity', options: lots[species] }] as Field[])
        : []),
      { name: 'note', label: 'Note', type: 'textarea' },
    ];
  };
  return (
    <ActionDialog
      title={`${row ? 'Modifier' : 'Ajouter'} — Dépenses & recettes`}
      mode={row ? 'update' : 'create'}
      fields={fields}
      initial={row ? toForm(row) : undefined}
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
    { key: 'kind', header: 'TYPE', render: (r) => kindLabel(r.kind) },
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
