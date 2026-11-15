import { ActionDialog } from '../components/module/ActionDialog';
import type { Field, ModuleConfig } from '../components/module/types';
import { api } from '../lib/api';
import { formatMoney } from '../lib/format';

/* ---------------------------------------------------------------------------------------------
 * API shape (backend contract of `/suppliers`, Task 4). Reconcile with the backend here only.
 * ------------------------------------------------------------------------------------------- */

/**
 * `GET /suppliers`. `balance` is derived: received purchases minus payments (the active farm's under a farm
 * header, the organisation's under "all farms").
 */
export interface SupplierRow {
  id: string;
  name: string;
  products: string | null;
  phone: string | null;
  email: string | null;
  /** The list item also carries the rest of the sheet, so an edit shows the stored values. */
  address: string | null;
  /** Absent is read as active. */
  active?: boolean;
  balance: number;
}

/* --------------------------------------------------------------------------------------------- */

const FIELDS: Field[] = [
  { name: 'name', label: 'Nom', type: 'text', required: true },
  { name: 'products', label: 'Produits fournis', type: 'text' },
  { name: 'phone', label: 'Téléphone', type: 'text' },
  { name: 'email', label: 'Email', type: 'text' },
  { name: 'address', label: 'Adresse', type: 'text' },
  { name: 'active', label: 'Actif', type: 'checkbox', defaultValue: true },
];

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Add / edit a supplier: the kit form engine with an email format check (an edit sends only what changed). */
function SupplierForm({ row, onSaved, onClose }: { row?: SupplierRow; onSaved: () => void; onClose: () => void }) {
  return (
    <ActionDialog
      title={`${row ? 'Modifier' : 'Ajouter'} — Fournisseurs`}
      mode={row ? 'update' : 'create'}
      fields={FIELDS}
      initial={row ? { ...row, active: row.active ?? true } : undefined}
      validate={(v) => (String(v.email).trim() !== '' && !EMAIL.test(String(v.email).trim()) ? "L'adresse email n'est pas valide" : null)}
      onSubmit={(body) => (row ? api.patch(`/suppliers/${row.id}`, body) : api.post('/suppliers', body))}
      onClose={onClose}
      onDone={onSaved}
    />
  );
}

/** Suppliers belong to the organisation, not to a farm: every write needs `update`, and stays possible under "all farms". */
export const fournisseurs: ModuleConfig<SupplierRow> = {
  slug: 'fournisseurs',
  group: 'Commercial',
  title: 'Fournisseurs',
  subtitle: 'Fiches fournisseurs, produits et soldes.',
  endpoint: '/suppliers',
  farmScoped: false,
  columns: [
    { key: 'name', header: 'NOM' },
    { key: 'products', header: 'PRODUITS FOURNIS' },
    { key: 'phone', header: 'TÉLÉPHONE' },
    { key: 'email', header: 'EMAIL' },
    { key: 'balance', header: 'SOLDE', render: (s) => formatMoney(s.balance) },
  ],
  form: SupplierForm,
  createPermission: 'update',
  deletePermission: 'update',
};
