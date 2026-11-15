// Organisation-wide logistics data (stock articles, suppliers) shared by `logistics.spec.ts` and the visual
// spec's reference rows. The organisation is ONE for every spec (one seeded `AgriPilot`), so both specs go through
// these find-or-create helpers: the articles and suppliers that carry a reference name (`Aliment ponte`,
// `Agro Provende SA`...) exist once whichever spec runs first, with the same unit, category and sheet.
import { api, type EnrolledUser } from './helpers.ts';

type Session = Pick<EnrolledUser, 'token'> & { farmId?: string };

export interface ItemSpec {
  name: string;
  category: 'ALIMENT' | 'MEDICAMENT' | 'VACCIN' | 'MATERIEL' | 'CONSOMMABLE';
  unit: string;
}

export interface SupplierSpec {
  name: string;
  products: string;
  phone: string;
  email: string;
}

/** The reference articles of `m_stocks` (unit and category as shown there). */
export const REFERENCE_ITEMS = {
  croissance: { name: 'Aliment croissance chair', category: 'ALIMENT', unit: 'kg' },
  ponte: { name: 'Aliment ponte', category: 'ALIMENT', unit: 'kg' },
  engraissement: { name: 'Aliment engraissement porc', category: 'ALIMENT', unit: 'kg' },
  gumboro: { name: 'Vaccin Gumboro', category: 'MEDICAMENT', unit: 'flacons' },
  copeaux: { name: 'Copeaux litière', category: 'CONSOMMABLE', unit: 'sacs' },
} satisfies Record<string, ItemSpec>;

/** The reference suppliers of `m_fournisseurs`. */
export const REFERENCE_SUPPLIERS = {
  agro: { name: 'Agro Provende SA', products: 'Aliments volaille & porc', phone: '+228 90 11 22 33', email: 'ventes@agroprovende.tg' },
  veto: { name: 'VetoPlus', products: 'Vaccins, médicaments', phone: '+228 91 44 55 66', email: 'contact@vetoplus.tg' },
  couvoir: { name: 'Couvoir du Golfe', products: "Poussins d'un jour", phone: '+228 92 77 88 99', email: 'info@couvoirgolfe.tg' },
} satisfies Record<string, SupplierSpec>;

/** The id of the article of that name, created when no spec has yet. */
export async function ensureItem(as: Session, spec: ItemSpec): Promise<string> {
  const found = await api<{ items: { id: string; name: string }[] }>('/stock-items?pageSize=200', { token: as.token, farmId: as.farmId });
  const existing = found.items.find((i) => i.name === spec.name);
  if (existing) return existing.id;
  return (await api<{ id: string }>('/stock-items', { method: 'POST', token: as.token, farmId: as.farmId, body: { ...spec, active: true } })).id;
}

/** The id of the supplier of that name, created when no spec has yet. */
export async function ensureSupplier(as: Session, spec: SupplierSpec): Promise<string> {
  const found = await api<{ items: { id: string; name: string }[] }>('/suppliers?pageSize=200', { token: as.token, farmId: as.farmId });
  const existing = found.items.find((s) => s.name === spec.name);
  if (existing) return existing.id;
  return (await api<{ id: string }>('/suppliers', { method: 'POST', token: as.token, farmId: as.farmId, body: spec })).id;
}
