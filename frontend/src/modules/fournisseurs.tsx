import type { ModuleConfig } from '../components/module/types';
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
  balance: number;
}

/* --------------------------------------------------------------------------------------------- */

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
  fields: [
    { name: 'name', label: 'Nom', type: 'text', required: true },
    { name: 'products', label: 'Produits fournis', type: 'text' },
    { name: 'phone', label: 'Téléphone', type: 'text' },
    { name: 'email', label: 'Email', type: 'text' },
  ],
  createPermission: 'update',
  deletePermission: 'update',
};
