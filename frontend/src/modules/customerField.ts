import type { Field } from '../components/module/types';
import { useEndpointOptions } from '../components/module/useEndpointOptions';
import { useAuth } from '../lib/auth';

/**
 * The `Client` select of the quote and invoice forms: the active customers, plus the current one of a record being
 * edited whatever its state (a customer deactivated since stays selectable, under its name). Needs `clients:read` for
 * the options; without it the select keeps the stored value.
 */
export function useCustomerField(current?: { customerId: string; customerName: string }): Field {
  const { can } = useAuth();
  const active = useEndpointOptions({ endpoint: '/customers', params: { active: 'true' } }, undefined, can('clients', 'read'));
  const kept = current && !active.some((o) => o.value === current.customerId) ? [{ value: current.customerId, label: current.customerName }] : [];
  return {
    name: 'customerId', label: 'Client', type: 'select', required: true, options: [...kept, ...active],
    optionsPermission: { module: 'clients', action: 'read' },
  };
}
