import type { Field, ModuleConfig } from '../components/module/types';
import { CustomerDetail } from '../pages/details/CustomerDetail';
import { CUSTOMER_TYPES, customerTypeLabel, type CustomerRow } from './salesShared';

const FIELDS: Field[] = [
  { name: 'name', label: 'Nom', type: 'text', required: true },
  { name: 'type', label: 'Type', type: 'select', required: true, options: CUSTOMER_TYPES },
  { name: 'phone', label: 'Téléphone', type: 'text' },
  { name: 'email', label: 'Email', type: 'text' },
  { name: 'city', label: 'Ville', type: 'text' },
  { name: 'address', label: 'Adresse', type: 'text' },
  { name: 'active', label: 'Actif', type: 'checkbox', only: 'update' },
];

/**
 * Customers belong to the organisation, not to a farm, and are master data: every write needs `update` on `clients`
 * (whatever the verb, like suppliers) and stays possible under "all farms", like suppliers.
 */
export const clients: ModuleConfig<CustomerRow> = {
  slug: 'clients',
  group: 'Commercial',
  title: 'Clients',
  subtitle: 'Particuliers, revendeurs, restaurants et grossistes.',
  endpoint: '/customers',
  farmScoped: false,
  columns: [
    { key: 'name', header: 'NOM' },
    { key: 'type', header: 'TYPE', render: (c) => customerTypeLabel(c.type) },
    { key: 'phone', header: 'TÉLÉPHONE' },
    { key: 'city', header: 'VILLE' },
  ],
  fields: FIELDS,
  createPermission: 'update',
  editPermission: 'update',
  deletePermission: 'update',
  detail: CustomerDetail,
};
