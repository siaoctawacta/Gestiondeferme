import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { ActionDialog } from '../components/module/ActionDialog';
import { LoadedRecord } from '../components/module/LoadedRecord';
import { toRowActions } from '../components/module/rowActions';
import type { Field, LineRow, ModuleConfig, RowAction } from '../components/module/types';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDate, formatMoney, formatNumber, todayIso } from '../lib/format';
import { linesTotal } from '../lib/money';
import { farmKey } from '../lib/query';
import { useDocumentSettings } from '../lib/documentSettings';
import { PAYMENT_METHODS } from './purchasingShared';
import { useCustomerField } from './customerField';
import { devis } from './devis';
import { INVOICE_ACTIONS } from './saleActions';
import { saleLineLabels, saleLinesField, saleLinesToForm, saleLinesToPayload } from './saleLines';
import {
  DuePill, addDays, draftGate, type CreditNoteRow, type InvoiceData, type InvoiceRow,
} from './salesShared';
import { lazyRetry } from '../components/lazyRetry';

// Loaded when the page opens, so the main bundle does not hold it (the config itself stays eager: the registry needs it).
const InvoiceDetail = lazyRetry(() => import('../pages/details/InvoiceDetail').then((m) => ({ default: m.InvoiceDetail })));
const CreditNotePrintDialog = lazyRetry(() => import('../pages/print/CreditNotePrintDialog').then((m) => ({ default: m.CreditNotePrintDialog })));

/* ----------------------------------------------------------------------------------------------
 * The invoice form: a draft is a daily entry (`create`). Issuing needs `update`, so the `Émettre la facture` box (and
 * the cash payment it brings) only exists for a user who holds it; without it the form saves a draft.
 * -------------------------------------------------------------------------------------------- */

const toForm = (i: InvoiceData) => ({
  customerId: i.customerId,
  date: i.date,
  dueDate: i.dueDate ?? '',
  lines: saleLinesToForm(i.lines),
});

/** The dialog: active customers are offered, plus the current one of a draft being edited, whatever its state. */
function InvoiceDialog({ title, record, onClose, onDone }: { title: string; record?: InvoiceData; onClose: () => void; onDone: () => void }) {
  const { can } = useAuth();
  const customer = useCustomerField(record);
  // The due date the API will give when the field is left empty: the invoice date plus the `invoiceDueDays` setting.
  const dueDays = useDocumentSettings().data?.invoiceDueDays;
  const canIssue = can('ventes', 'update');

  const fields = (values: Record<string, unknown>): Field[] => [
    customer,
    { name: 'date', label: 'Date', type: 'date', required: true, defaultValue: todayIso },
    {
      name: 'dueDate', label: 'Échéance', type: 'date',
      // What the API will use when the field is left empty.
      hint: (v) => {
        const due = dueDays !== undefined && v.date ? addDays(String(v.date), dueDays) : '';
        return v.dueDate || !due ? undefined : `Par défaut : ${due}`;
      },
    },
    // The sources offered are those sellable on the invoice's date.
    saleLinesField(String(values.date ?? ''), record ? saleLineLabels(record.lines) : undefined),
    ...(canIssue
      ? ([
          { name: 'issue', label: 'Émettre la facture', type: 'checkbox', only: 'create', defaultValue: true },
          ...(values.issue === true
            ? ([
                { name: 'cash', label: 'Paiement comptant', type: 'number', only: 'create', min: 0, step: 0.01 },
                { name: 'method', label: 'Mode de paiement', type: 'select', only: 'create', options: PAYMENT_METHODS, defaultValue: 'ESPECES' },
              ] as Field[])
            : []),
        ] as Field[])
      : []),
  ];

  return (
    <ActionDialog
      title={title}
      // Seven columns need ~640px.
      wide
      mode={record ? 'update' : 'create'}
      fields={fields}
      initial={record ? toForm(record) : undefined}
      validate={(v) => (v.issue === true && Number(v.cash || 0) > linesTotal(v.lines as LineRow[]) ? 'Le montant dépasse le reste dû' : null)}
      toPayload={(v, mode) => {
        const base = { customerId: v.customerId, date: v.date, dueDate: v.dueDate, lines: saleLinesToPayload(v.lines as LineRow[]) };
        if (mode === 'update') return base;
        const cash = Number(v.cash || 0);
        return {
          ...base,
          // `issue` only routes the request (see `onSubmit`); the API's issued route takes the draft's body plus the payment.
          issue: v.issue === true,
          ...(v.issue === true && cash > 0 ? { payment: { amount: cash, method: v.method } } : {}),
        };
      }}
      onSubmit={(body) => {
        if (record) return api.patch(`/sales/${record.id}`, body);
        const { issue, ...rest } = body as { issue?: boolean };
        return api.post(issue ? '/sales/issued' : '/sales', rest);
      }}
      onClose={onClose}
      onDone={onDone}
    />
  );
}

/** Add an invoice (issued at once, or a draft), or correct a draft: a list row has no lines, so an edit loads the invoice first. */
function InvoiceForm({ row, onSaved, onClose }: { row?: InvoiceRow; onSaved: () => void; onClose: () => void }) {
  const { farmId } = useAuth();
  const queryClient = useQueryClient();
  const title = `${row ? 'Modifier' : 'Ajouter'} — Ventes`;
  const form = (record?: InvoiceData) => (
    <InvoiceDialog
      title={title}
      record={record}
      onClose={onClose}
      onDone={() => {
        // The detail cached for this invoice is stale once its lines changed.
        if (record) void queryClient.invalidateQueries({ queryKey: farmKey(farmId, '/sales', 'detail', record.id) });
        onSaved();
      }}
    />
  );
  if (!row) return form();
  return (
    <LoadedRecord<InvoiceData> title={title} queryKey={['/sales', 'detail', row.id]} path={`/sales/${row.id}`} onClose={onClose}>
      {form}
    </LoadedRecord>
  );
}

const actions = toRowActions<InvoiceRow>(INVOICE_ACTIONS);

/* ----------------------------------------------------------------------------------------------
 * The `Avoirs` tab: credit notes are made from an invoice (no `Ajouter`) and are final (no edit, no delete).
 * -------------------------------------------------------------------------------------------- */

const printAction: RowAction<CreditNoteRow> = {
  key: 'print',
  label: 'Imprimer',
  icon: Printer,
  permission: 'read',
  dialog: ({ row, onClose }) => <CreditNotePrintDialog row={row} onClose={onClose} />,
};

export const avoirs: ModuleConfig<CreditNoteRow> = {
  slug: 'ventes',
  group: 'Commercial',
  title: 'Avoirs',
  subtitle: 'Corrections de factures, avec ou sans retour des marchandises.',
  endpoint: '/credit-notes',
  columns: [
    { key: 'date', header: 'DATE', render: (c) => formatDate(c.date) },
    { key: 'number', header: 'N° AVOIR' },
    { key: 'invoiceNumber', header: 'FACTURE', render: (c) => <Link to={`/m/ventes/${c.invoiceId}`} className="font-semibold hover:underline">{c.invoiceNumber}</Link> },
    { key: 'customerName', header: 'CLIENT' },
    { key: 'reason', header: 'MOTIF' },
    { key: 'withReturn', header: 'RETOUR', render: (c) => (c.withReturn ? 'Oui' : 'Non') },
    { key: 'total', header: 'MONTANT', render: (c) => formatMoney(c.total) },
  ],
  fields: [],
  noCreate: true,
  canEdit: () => false,
  canDelete: () => false,
  rowLabel: (c) => c.number,
  actions: [printAction],
};

/**
 * `Ventes` as `m_ventes.png`: invoices (paid in cash, in part or on credit) with the `Devis` and `Avoirs` tabs. Only the
 * total of records is counted (no status tiles or filter). A draft is a daily entry; edit and delete stay on drafts
 * (`Enregistrement verrouillé` otherwise); the workflow buttons come from `INVOICE_ACTIONS`, like the detail page.
 */
export const ventes: ModuleConfig<InvoiceRow> = {
  slug: 'ventes',
  group: 'Commercial',
  title: 'Ventes',
  tabLabel: 'Factures',
  subtitle: 'Factures, paiements comptants, partiels ou à crédit.',
  endpoint: '/sales',
  columns: [
    { key: 'date', header: 'DATE', render: (i) => formatDate(i.date) },
    { key: 'number', header: 'N° FACTURE', render: (i) => i.number ?? '—' },
    { key: 'customerName', header: 'CLIENT' },
    { key: 'product', header: 'PRODUIT' },
    { key: 'quantity', header: 'QUANTITÉ', render: (i) => formatNumber(i.quantity) },
    { key: 'total', header: 'TOTAL', render: (i) => formatMoney(i.total) },
    { key: 'due', header: 'RESTE DÛ', render: (i) => <DuePill row={i} /> },
  ],
  form: InvoiceForm,
  rowLabel: (i) => i.number ?? `Brouillon ${i.customerName}`,
  detail: InvoiceDetail,
  editPermission: 'create',
  deletePermission: 'create',
  canEdit: draftGate,
  canDelete: draftGate,
  actions,
  tabs: [
    { key: 'devis', label: 'Devis', config: devis },
    { key: 'avoirs', label: 'Avoirs', config: avoirs },
  ],
};
