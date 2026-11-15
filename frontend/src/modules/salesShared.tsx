import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Check, FileText, Send, X, type LucideIcon } from 'lucide-react';
import { ActionDialog } from '../components/module/ActionDialog';
import { ConfirmDialog } from '../components/module/ConfirmDialog';
import { LoadedRecord } from '../components/module/LoadedRecord';
import type { Field, ModuleConfig, RowAction, StatusDef } from '../components/module/types';
import { useEndpointOptions } from '../components/module/useEndpointOptions';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDate, formatMoney, todayIso } from '../lib/format';
import type { Action } from '../lib/modules';
import { farmKey } from '../lib/query';
import { LOCKED } from './purchasingShared';
import { saleLineLabels, saleLinesField, saleLinesToForm, saleLinesToPayload, type SaleLineData } from './saleLines';

export type { EggUnit, SaleLineData, SaleLineKind, Sellable } from './saleLines';

/* ---------------------------------------------------------------------------------------------
 * API shapes (backend contract of `/customers` and `/quotes`, Task 2). Reconcile with the backend here only.
 * The shapes of a sale line and of `/sales/sellables` are at the top of `saleLines.tsx`.
 * ------------------------------------------------------------------------------------------- */

export type CustomerType = 'PARTICULIER' | 'REVENDEUR' | 'RESTAURANT' | 'GROSSISTE';

/** `GET /customers`. `balance` is derived (what is due, less what is owed back). */
export interface CustomerRow {
  id: string;
  name: string;
  type: CustomerType;
  phone: string | null;
  email: string | null;
  city: string | null;
  address: string | null;
  active: boolean;
  balance: number;
}

/** `GET /customers/:id`: the row and what the customer was invoiced, paid and credited. */
export interface CustomerData extends CustomerRow {
  invoiced: number;
  paid: number;
  credited: number;
}

/** What `GET /quotes` shows of a status: derived by the API, `EXPIRE` is a sent quote past its validity. */
export type QuoteStatus = 'BROUILLON' | 'ENVOYE' | 'ACCEPTE' | 'REFUSE' | 'FACTURE' | 'EXPIRE';

/** `GET /quotes`. `product` is the first line's designation (`+n` when more), `quantity` / `unit` its quantity and unit. */
export interface QuoteRow {
  id: string;
  reference: string;
  /** `YYYY-MM-DD` */
  date: string;
  /** `YYYY-MM-DD` */
  validUntil: string | null;
  customerId: string;
  customerName: string;
  product: string;
  quantity: number;
  unit: string | null;
  total: number;
  status: QuoteStatus;
  invoiceId: string | null;
  invoiceNumber: string | null;
}

/** One step of a quote's history (`at` is the ISO timestamp). */
export interface QuoteStep {
  step: Exclude<QuoteStatus, 'EXPIRE'>;
  at: string;
  by: string | null;
}

/** `GET /quotes/:id`. */
export interface QuoteData extends QuoteRow {
  customerPhone: string | null;
  customerAddress: string | null;
  note: string | null;
  lines: SaleLineData[];
  history: QuoteStep[];
}

/** What the quote actions need of a quote: a list row or the detail both fit. */
export type QuoteRef = Pick<QuoteRow, 'id' | 'reference' | 'status'>;

/* --------------------------------------------------------------------------------------------- */

export const CUSTOMER_TYPES: { value: CustomerType; label: string }[] = [
  { value: 'PARTICULIER', label: 'Particulier' },
  { value: 'REVENDEUR', label: 'Revendeur' },
  { value: 'RESTAURANT', label: 'Restaurant' },
  { value: 'GROSSISTE', label: 'Grossiste' },
];
export const customerTypeLabel = (t: string) => CUSTOMER_TYPES.find((x) => x.value === t)?.label ?? t;

export const QUOTE_STATUSES: StatusDef[] = [
  { value: 'BROUILLON', label: 'Brouillon', tone: 'neutral' },
  { value: 'ENVOYE', label: 'Envoyé', tone: 'warning' },
  { value: 'ACCEPTE', label: 'Accepté', tone: 'success' },
  { value: 'REFUSE', label: 'Refusé', tone: 'danger' },
  { value: 'FACTURE', label: 'Facturé', tone: 'success' },
  { value: 'EXPIRE', label: 'Expiré', tone: 'danger' },
];
export const quoteStatusDef = (s: string) => QUOTE_STATUSES.find((x) => x.value === s);

/** Only a draft can be edited or deleted. */
const draftGate = (q: Pick<QuoteRow, 'status'>): true | string => (q.status === 'BROUILLON' ? true : LOCKED);

/* ----------------------------------------------------------------------------------------------
 * Quote workflow actions: shared by the list rows and the detail page. Every one is a daily entry
 * (`create` on ventes); the API refuses what the status does not allow.
 * -------------------------------------------------------------------------------------------- */

export interface QuoteDialogProps {
  row: QuoteRef;
  onClose: () => void;
  onDone: () => void;
}

export interface QuoteActionDef {
  key: string;
  label: string;
  icon: LucideIcon;
  permission: Action;
  visible: (q: QuoteRef) => boolean;
  Dialog: (props: QuoteDialogProps) => ReactNode;
}

function quoteStep(key: string, title: (ref: string) => string, message: (ref: string) => string, confirmLabel: string) {
  return function QuoteStepDialog({ row, onClose, onDone }: QuoteDialogProps) {
    return (
      <ConfirmDialog
        title={title(row.reference)}
        message={message(row.reference)}
        confirmLabel={confirmLabel}
        onClose={onClose}
        onConfirm={async () => { await api.post(`/quotes/${row.id}/${key}`); onDone(); }}
      />
    );
  };
}

export const QUOTE_ACTIONS: QuoteActionDef[] = [
  {
    key: 'send', label: 'Envoyer', icon: Send, permission: 'create', visible: (q) => q.status === 'BROUILLON',
    Dialog: quoteStep('send', (r) => `Envoyer ${r}`, (r) => `Marquer le devis ${r} comme envoyé ? Il ne pourra plus être modifié.`, 'Envoyer'),
  },
  {
    key: 'accept', label: 'Accepter', icon: Check, permission: 'create', visible: (q) => q.status === 'ENVOYE' || q.status === 'EXPIRE',
    Dialog: quoteStep('accept', (r) => `Accepter ${r}`, (r) => `Le client a accepté le devis ${r} ?`, 'Accepter'),
  },
  {
    key: 'refuse', label: 'Refuser', icon: X, permission: 'create', visible: (q) => q.status === 'ENVOYE' || q.status === 'EXPIRE',
    Dialog: quoteStep('refuse', (r) => `Refuser ${r}`, (r) => `Le client a refusé le devis ${r} ?`, 'Refuser'),
  },
  {
    key: 'convert', label: 'Facturer', icon: FileText, permission: 'create', visible: (q) => ['ENVOYE', 'ACCEPTE', 'EXPIRE'].includes(q.status),
    Dialog: quoteStep('convert', (r) => `Facturer ${r}`, (r) => `Créer une facture brouillon à partir de ${r} ?`, 'Facturer'),
  },
];

const actions: RowAction<QuoteRow>[] = QUOTE_ACTIONS.map((a) => ({
  key: a.key, label: a.label, icon: a.icon, permission: a.permission, visible: a.visible, dialog: a.Dialog,
}));

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
  const { can } = useAuth();
  const active = useEndpointOptions({ endpoint: '/customers', params: { active: 'true' } }, undefined, can('clients', 'read'));
  const current = record && !active.some((o) => o.value === record.customerId) ? [{ value: record.customerId, label: record.customerName }] : [];
  const fields = (values: Record<string, unknown>): Field[] => [
    {
      name: 'customerId', label: 'Client', type: 'select', required: true, options: [...current, ...active],
      optionsPermission: { module: 'clients', action: 'read' },
    },
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
 * The `Devis` tab of the `ventes` page (Task 8 registers it): quotes are daily entries, so whoever may enter one
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
