// Organisation-wide customers shared by `commerce.spec.ts` and the visual spec's reference rows (`m_clients`). The
// organisation is ONE for every spec, so both go through this find-or-create helper: a customer that carries a
// reference name exists once, whichever spec runs first, with the same type, phone and city.
import { api, type EnrolledUser } from './helpers.ts';

type Session = Pick<EnrolledUser, 'token'> & { farmId?: string };

export interface CustomerSpec {
  name: string;
  type: 'PARTICULIER' | 'REVENDEUR' | 'RESTAURANT' | 'GROSSISTE';
  phone: string;
  city: string;
}

/** The reference customers of `m_clients`. */
export const REFERENCE_CUSTOMERS = {
  palmier: { name: 'Restaurant Le Palmier', type: 'RESTAURANT', phone: '+228 93 12 34 56', city: 'Lomé' },
  afi: { name: 'Marché Hédzranawoé — Mme Afi', type: 'REVENDEUR', phone: '+228 98 65 43 21', city: 'Lomé' },
  ramco: { name: 'SuperMarché Ramco', type: 'GROSSISTE', phone: '+228 22 21 00 00', city: 'Lomé' },
} satisfies Record<string, CustomerSpec>;

/** The id of the customer of that name, created when no spec has yet. */
export async function ensureCustomer(as: Session, spec: CustomerSpec): Promise<string> {
  const found = await api<{ items: { id: string; name: string }[] }>('/customers?pageSize=200', { token: as.token, farmId: as.farmId });
  const existing = found.items.find((c) => c.name === spec.name);
  if (existing) return existing.id;
  return (await api<{ id: string }>('/customers', { method: 'POST', token: as.token, farmId: as.farmId, body: spec })).id;
}
