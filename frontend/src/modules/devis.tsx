import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { ActionDialog } from '../components/module/ActionDialog';
import { LoadedRecord } from '../components/module/LoadedRecord';
import { toRowActions } from '../components/module/rowActions';
import type { Field, ModuleConfig } from '../components/module/types';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDate, formatMoney, todayIso } from '../lib/format';
import { farmKey } from '../lib/query';
import { useCustomerField } from './customerField';
import { QUOTE_ACTIONS } from './quoteActions';
import { saleLineLabels, saleLinesField, saleLinesToForm, saleLinesToPayload } from './saleLines';
import { QUOTE_STATUSES, draftGate, type QuoteData, type QuoteRow } from './salesShared';

const actions = toRowActions<QuoteRow>(QUOTE_ACTIONS);

/* ----------------------------------------------------------------------------------------------
 * The quote form
 * -------------------------------------------------------------------------------------------- */

const toForm = (q: QuoteData) => ({
  customerId: q.customerId,
  date: q.date,
  validUntil: q.validUntil ?? '',
  lines: saleLinesToForm(q.lines),
});

/** The dialog: active customers are offered, plus the current one of a quote being edited, whatever its state. */
function QuoteDialog({ title, record, onClose, onDone }: { title: string; record?: QuoteData; onClose: () => void; onDone: () => void }) {
  const customer = useCustomerField(record);
  const fields = (values: Record<string, unknown>): Field[] => [
    customer,
    { name: 'date', label: 'Date', type: 'date', required: true, defaultValue: todayIso },
    { name: 'validUntil', label: "Valable jusqu'au", type: 'date' },
    // The sources offered are those sellable on the quote's date.
    saleLinesField(String(values.date ?? ''), record ? saleLineLabels(record.lines) : undefined),
  ];
  return (
    <ActionDialog
      title={title}
      // Seven columns need ~640px.
      wide
      mode={record ? 'update' : 'create'}
      fields={fields}
      initial={record ? toForm(record) : undefined}
      toPayload={(v) => ({
        customerId: v.customerId,
        date: v.date,
        validUntil: v.validUntil,
        lines: saleLinesToPayload(v.lines as Record<string, string>[]),
      })}
      onSubmit={(body) => (record ? api.patch(`/quotes/${record.id}`, body) : api.post('/quotes', body))}
      onClose={onClose}
      onDone={onDone}
    />
  );
}

/** Add a quote, or correct one (`Brouillon` only): a list row has no lines, so an edit loads the quote first. */
function QuoteForm({ row, onSaved, onClose }: { row?: QuoteRow; onSaved: () => void; onClose: () => void }) {
  const { farmId } = useAuth();
  const queryClient = useQueryClient();
  const title = `${row ? 'Modifier' : 'Ajouter'} — Devis`;
  const form = (record?: QuoteData) => (
    <QuoteDialog
      title={title}
      record={record}
      onClose={onClose}
      onDone={() => {
        // The detail cached for this quote is stale once its lines changed.
        if (record) void queryClient.invalidateQueries({ queryKey: farmKey(farmId, '/quotes', 'detail', record.id) });
        onSaved();
      }}
    />
  );
  if (!row) return form();
  return (
    <LoadedRecord<QuoteData> title={title} queryKey={['/quotes', 'detail', row.id]} path={`/quotes/${row.id}`} onClose={onClose}>
      {form}
    </LoadedRecord>
  );
}

/**
 * The `Devis` tab of the `ventes` page (registered by `ventes.tsx`): quotes are daily entries, so whoever may enter one
 * (`create`) also corrects, deletes and moves it along; farm-scoped, so read-only under "all farms".
 */
export const devis: ModuleConfig<QuoteRow> = {
  slug: 'ventes',
  group: 'Commercial',
  title: 'Devis',
  subtitle: 'Propositions commerciales, envoi, acceptation et facturation.',
  endpoint: '/quotes',
  columns: [
    { key: 'date', header: 'DATE', render: (q) => formatDate(q.date) },
    {
      key: 'reference',
      header: 'N° DEVIS',
      render: (q) => <Link to={`/m/ventes/devis/${q.id}`} className="font-semibold hover:underline">{q.reference}</Link>,
    },
    { key: 'customerName', header: 'CLIENT' },
    { key: 'product', header: 'PRODUIT' },
    { key: 'total', header: 'TOTAL', render: (q) => formatMoney(q.total) },
    { key: 'validUntil', header: 'VALIDITÉ', render: (q) => (q.validUntil ? formatDate(q.validUntil) : '—') },
    { key: 'status', header: 'STATUT' },
  ],
  statuses: QUOTE_STATUSES,
  statusKey: 'status',
  form: QuoteForm,
  rowLabel: (q) => q.reference,
  editPermission: 'create',
  deletePermission: 'create',
  canEdit: draftGate,
  canDelete: draftGate,
  actions,
};
