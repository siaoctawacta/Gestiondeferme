import { useQueryClient } from '@tanstack/react-query';
import { ActionDialog } from '../components/module/ActionDialog';
import { LoadedRecord } from '../components/module/LoadedRecord';
import { useEndpointOptions } from '../components/module/useEndpointOptions';
import { toRowActions } from '../components/module/rowActions';
import type { Field, ModuleConfig } from '../components/module/types';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatMoney, formatNumber, todayIso } from '../lib/format';
import { linesTotal } from '../lib/money';
import { farmKey } from '../lib/query';
import { PurchaseDetail } from '../pages/details/PurchaseDetail';
import { PURCHASE_ACTIONS } from './purchaseActions';
import { stockItemOptions } from './stocksShared';
import { ACTIVITIES, PURCHASE_STATUSES, editableGate, type PurchaseData, type PurchaseRow } from './purchasingShared';

const fields = (suppliers: { value: string; label: string }[]): Field[] => [
  { name: 'supplierId', label: 'Fournisseur', type: 'select', required: true, options: suppliers },
  { name: 'date', label: 'Date', type: 'date', required: true, defaultValue: todayIso },
  { name: 'activity', label: 'Activité', type: 'select', required: true, defaultValue: 'GENERAL', options: ACTIVITIES },
  {
    name: 'lines',
    label: 'Lignes',
    type: 'lines',
    minRows: 1,
    addLabel: 'Ajouter une ligne',
    defaultValue: [{ itemId: '', quantity: '', unitPrice: '' }],
    columns: [
      { name: 'itemId', label: 'Article', type: 'select', required: true, unique: true, options: stockItemOptions() },
      { name: 'quantity', label: 'Quantité', type: 'number', required: true, min: 0.01, step: 0.01 },
      { name: 'unitPrice', label: 'Prix unitaire', type: 'number', required: true, min: 0, step: 0.01 },
    ],
    footer: (rows) => <p className="text-sm font-semibold">Total : {formatMoney(linesTotal(rows))}</p>,
  },
];

const toForm = (p: PurchaseData) => ({
  supplierId: p.supplierId,
  date: p.date,
  activity: p.activity,
  lines: p.lines.map((l) => ({ itemId: l.itemId, quantity: l.quantity, unitPrice: l.unitPrice })),
});

/** The dialog: suppliers offered are the active ones, plus the current supplier of a request being edited, whatever its state. */
function PurchaseDialog({ title, record, onClose, onDone }: { title: string; record?: PurchaseData; onClose: () => void; onDone: () => void }) {
  const active = useEndpointOptions({ endpoint: '/suppliers', params: { active: 'true' } });
  const current = record && !active.some((o) => o.value === record.supplierId) ? [{ value: record.supplierId, label: record.supplierName }] : [];
  return (
    <ActionDialog
      title={title}
      mode={record ? 'update' : 'create'}
      fields={fields([...current, ...active])}
      initial={record ? toForm(record) : undefined}
      onSubmit={(body) => (record ? api.patch(`/purchases/${record.id}`, body) : api.post('/purchases', body))}
      onClose={onClose}
      onDone={onDone}
    />
  );
}

/**
 * Request (add) or correct (edit, `DEMANDE` only) a purchase. A list row carries neither its lines nor its supplier
 * id, so an edit loads the purchase first; only what changed is sent.
 */
function PurchaseForm({ row, onSaved, onClose }: { row?: PurchaseRow; onSaved: () => void; onClose: () => void }) {
  const { farmId } = useAuth();
  const queryClient = useQueryClient();
  const title = `${row ? 'Modifier' : 'Ajouter'} — Achats`;
  const form = (record?: PurchaseData) => (
    <PurchaseDialog
      title={title}
      record={record}
      onClose={onClose}
      onDone={() => {
        // The detail cached for this purchase is stale once its lines or supplier changed.
        if (record) void queryClient.invalidateQueries({ queryKey: farmKey(farmId, '/purchases', 'detail', record.id) });
        onSaved();
      }}
    />
  );
  if (!row) return form();
  return (
    <LoadedRecord<PurchaseData> title={title} queryKey={['/purchases', 'detail', row.id]} path={`/purchases/${row.id}`} onClose={onClose}>
      {form}
    </LoadedRecord>
  );
}

const actions = toRowActions<PurchaseRow>(PURCHASE_ACTIONS);

export const achats: ModuleConfig<PurchaseRow> = {
  slug: 'achats',
  group: 'Commercial',
  title: 'Achats',
  subtitle: 'Demandes, validation, bons de commande et réception.',
  endpoint: '/purchases',
  columns: [
    { key: 'date', header: 'DATE' },
    { key: 'reference', header: 'RÉFÉRENCE' },
    { key: 'supplierName', header: 'FOURNISSEUR' },
    { key: 'article', header: 'ARTICLE' },
    { key: 'quantity', header: 'QUANTITÉ', render: (p) => (p.unit ? `${formatNumber(p.quantity)} ${p.unit}` : formatNumber(p.quantity)) },
    { key: 'status', header: 'STATUT' },
    { key: 'amount', header: 'MONTANT', render: (p) => formatMoney(p.amount) },
  ],
  statuses: PURCHASE_STATUSES,
  statusKey: 'status',
  form: PurchaseForm,
  rowLabel: (p) => p.reference,
  detail: PurchaseDetail,
  // A request is a daily entry: whoever may enter it (`create`) corrects or withdraws it, while it is a `Demande`.
  editPermission: 'create',
  deletePermission: 'create',
  canEdit: editableGate,
  canDelete: editableGate,
  actions,
};
