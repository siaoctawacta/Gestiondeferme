// Stock articles with their levels, suppliers, purchases in every state, and health (acts, plan, biosecurity,
// incidents, quarantine): the rows of m_stocks, m_fournisseurs, m_achats and m_sante plus what the alerts need.
// Stock consumption is dated relative to today (the days of stock look at the last 30 days), so the days of stock
// (6, 2, 1, 13) hold whatever the day.
import type { DemoContext } from './demo-client';
import { ago, ref } from './demo-dates';
import type { ProductionIds } from './demo-production';

export interface LogisticsIds {
  items: Record<string, string>;
  suppliers: Record<string, string>;
}

export async function seedLogistics(ctx: DemoContext): Promise<LogisticsIds> {
  const { api } = ctx;
  const post = api.post.bind(api);

  const itemSpecs: Record<string, [string, string, string]> = {
    croissance: ['Aliment croissance chair', 'ALIMENT', 'kg'],
    ponte: ['Aliment ponte', 'ALIMENT', 'kg'],
    engraissement: ['Aliment engraissement porc', 'ALIMENT', 'kg'],
    gumboro: ['Vaccin Gumboro', 'MEDICAMENT', 'flacons'],
    copeaux: ['Copeaux litière', 'CONSOMMABLE', 'sacs'],
    virkon: ['Désinfectant Virkon S', 'CONSOMMABLE', 'kg'],
    vermifuge: ['Vermifuge porcin', 'MEDICAMENT', 'flacons'],
    newcastle: ['Vaccin Newcastle', 'VACCIN', 'flacons'],
  };
  const items: Record<string, string> = {};
  for (const [key, [name, category, unit]] of Object.entries(itemSpecs)) {
    items[key] = (
      await post('/stock-items', { name, category, unit, active: true })
    ).id;
  }
  const supplierSpecs: Record<string, object> = {
    agro: {
      name: 'Agro Provende SA',
      products: 'Aliments volaille & porc',
      phone: '+228 90 11 22 33',
      email: 'ventes@agroprovende.tg',
    },
    veto: {
      name: 'VetoPlus',
      products: 'Vaccins, médicaments',
      phone: '+228 91 44 55 66',
      email: 'contact@vetoplus.tg',
    },
    couvoir: {
      name: 'Couvoir du Golfe',
      products: "Poussins d'un jour",
      phone: '+228 92 77 88 99',
      email: 'info@couvoirgolfe.tg',
    },
  };
  const suppliers: Record<string, string> = {};
  for (const [key, spec] of Object.entries(supplierSpecs))
    suppliers[key] = (await post('/suppliers', spec)).id;

  // Stock: minimum, then entry and consumption (the quantity left is the shown quantity of the reference).
  const stock: [string, number, number, number, number][] = [
    // article, minimum, entered, unit cost, consumed
    ['croissance', 2000, 25000, 340, 20800],
    ['ponte', 1500, 12900, 310, 12000],
    ['engraissement', 1500, 15600, 280, 15000],
    ['copeaux', 40, 260, 1500, 180],
  ];
  for (const [key, minQty, entered, unitCost, consumed] of stock) {
    await api.put(`/stock/${items[key]}/thresholds`, { minQty });
    await post('/stock/movements', {
      itemId: items[key],
      type: 'ENTREE',
      date: ago(28),
      quantity: entered,
      unitCost,
      reason: 'ACHAT',
    });
    await post('/stock/movements', {
      itemId: items[key],
      type: 'SORTIE',
      date: ago(2),
      quantity: consumed,
      reason: 'CONSOMMATION',
    });
  }
  await api.put(`/stock/${items.gumboro}/thresholds`, { minQty: 5 });
  // 2 flacons in stock, plus the 10 of the received purchase below: 12.
  await post('/stock/movements', {
    itemId: items.gumboro,
    type: 'ENTREE',
    date: ago(30),
    quantity: 2,
    unitCost: 12000,
    reason: 'ACHAT',
  });
  // Two lots with an expiry date: one expiring in twelve days, one expired five days ago.
  await post('/stock/movements', {
    itemId: items.vermifuge,
    type: 'ENTREE',
    date: ago(40),
    quantity: 6,
    unitCost: 8500,
    reason: 'ACHAT',
    lotNumber: 'VP-2026-07',
    expiryDate: ago(-12),
  });
  await post('/stock/movements', {
    itemId: items.newcastle,
    type: 'ENTREE',
    date: ago(75),
    quantity: 4,
    unitCost: 9000,
    reason: 'ACHAT',
    lotNumber: 'NC-2026-04',
    expiryDate: ago(5),
  });

  // Purchases: the next numbers are DA-0087, DA-0088, DA-0089 and BC-0141, BC-0142.
  await ctx.setCounter('DA', 86, 'raise');
  await ctx.setCounter('BC', 140, 'raise');
  const purchase = async (
    supplierId: string,
    date: string,
    itemId: string,
    quantity: number,
    unitPrice: number,
  ) =>
    (
      await post('/purchases', {
        supplierId,
        date,
        lines: [{ itemId, quantity, unitPrice }],
      })
    ).id;
  const order = async (id: string) => {
    await post(`/purchases/${id}/validate`, {});
    await post(`/purchases/${id}/order`, {});
  };
  const received = await purchase(
    suppliers.veto,
    ref('2026-10-15'),
    items.gumboro,
    10,
    12000,
  );
  await order(received);
  await post(`/purchases/${received}/receive`, {
    date: ref('2026-10-16'),
    lines: [
      {
        itemId: items.gumboro,
        receivedQuantity: 10,
        lotNumber: 'GB-2026-10',
        expiryDate: ago(-170),
      },
    ],
  });
  await post(`/purchases/${received}/payments`, {
    date: ref('2026-10-20'),
    amount: 50000,
    method: 'MOBILE_MONEY',
    reference: 'MM-77120',
  });
  await order(
    await purchase(suppliers.agro, ref('2026-10-20'), items.ponte, 3000, 310),
  );
  await purchase(
    suppliers.agro,
    ref('2026-10-22'),
    items.engraissement,
    4000,
    280,
  );
  // The other states: validated, received and paid (DA-0091 / BC-0143), cancelled.
  const validated = await purchase(
    suppliers.agro,
    ref('2026-10-24'),
    items.croissance,
    2000,
    340,
  );
  await post(`/purchases/${validated}/validate`, {});
  const paid = await purchase(suppliers.veto, ago(14), items.virkon, 10, 4500);
  await order(paid);
  await post(`/purchases/${paid}/receive`, {
    date: ago(12),
    lines: [{ itemId: items.virkon, receivedQuantity: 10 }],
  });
  await post(`/purchases/${paid}/payments`, {
    date: ago(10),
    amount: 45000,
    method: 'VIREMENT',
    reference: 'VIR-2026-1042',
  });
  const cancelled = await purchase(
    suppliers.couvoir,
    ago(9),
    items.copeaux,
    10,
    1500,
  );
  await post(`/purchases/${cancelled}/cancel`, {
    reason: 'Article commandé ailleurs',
  });

  return { items, suppliers };
}

export async function seedHealth(
  ctx: DemoContext,
  production: ProductionIds,
): Promise<void> {
  const { api } = ctx;
  const post = api.post.bind(api);
  const act = (body: object) => post('/health-acts', body);
  const { lots, animals } = production;

  // The planned vaccination is dated two days ahead: its reference date (2026-10-24) is past and would read `En retard`.
  await act({
    type: 'VACCINATION',
    status: 'PLANIFIE',
    date: ago(-2),
    batchId: lots['LC-2026-15'],
    productName: 'Gumboro',
    dose: '1 goutte',
    veterinarian: 'Dr Koffi',
  });
  await act({
    type: 'VACCINATION',
    status: 'REALISE',
    date: ref('2026-10-18'),
    batchId: lots['LC-2026-14'],
    productName: 'Newcastle',
    dose: 'Eau de boisson',
    veterinarian: 'Dr Koffi',
  });
  await act({
    type: 'TRAITEMENT',
    status: 'REALISE',
    date: ref('2026-10-20'),
    animalId: animals['TR-021'],
    productName: 'Fer injectable porcelets',
    dose: '1 ml',
    veterinarian: 'Dr Amah',
  });
  await act({
    type: 'DESINFECTION',
    status: 'PLANIFIE',
    date: ref('2026-10-15'),
    buildingId: ctx.buildings.get('Porcherie 2'),
    productName: 'Virkon S',
    dose: '1%',
    veterinarian: 'Équipe',
  });
  // Late acts: a planned vaccination and a planned treatment whose day has passed.
  await act({
    type: 'VACCINATION',
    status: 'PLANIFIE',
    date: ago(5),
    batchId: lots['LC-2026-14'],
    productName: 'Newcastle rappel',
    dose: 'Eau de boisson',
    veterinarian: 'Dr Koffi',
  });
  await act({
    type: 'TRAITEMENT',
    status: 'PLANIFIE',
    date: ago(4),
    animalId: animals['TR-027'],
    productName: 'Déparasitage',
    dose: '2 ml',
    veterinarian: 'Dr Amah',
  });
  // A treatment with a withdrawal period (10 days from the day it is given) and a diagnosis.
  await act({
    type: 'TRAITEMENT',
    status: 'REALISE',
    date: ago(4),
    batchId: lots['LC-2026-15'],
    productName: 'Amoxicilline',
    dose: '10 mg/kg',
    durationDays: 3,
    withdrawalDays: 10,
    veterinarian: 'Dr Koffi',
    symptoms: 'Fientes liquides',
    diagnosis: 'Entérite bactérienne',
  });
  await act({
    type: 'DIAGNOSTIC',
    status: 'REALISE',
    date: ago(6),
    batchId: lots['LP-2026-03'],
    veterinarian: 'Dr Koffi',
    symptoms: 'Baisse de ponte',
    diagnosis: 'Stress thermique',
    note: 'Ventilation renforcée',
  });

  await post('/vaccination-plans', {
    name: 'Plan chair standard',
    species: 'AVICOLE',
    type: 'CHAIR',
    items: [
      { ageDays: 7, productName: 'Newcastle', dose: 'Eau de boisson' },
      { ageDays: 14, productName: 'Gumboro', dose: '1 goutte' },
      { ageDays: 21, productName: 'Newcastle rappel', dose: 'Eau de boisson' },
    ],
  });
  await post('/biosecurity-logs', {
    date: ago(3),
    type: 'NETTOYAGE',
    buildingId: ctx.buildings.get('Poulailler A'),
    productName: 'Eau savonneuse',
  });
  await post('/biosecurity-logs', {
    date: ago(2),
    type: 'PEDILUVE',
    buildingId: ctx.buildings.get('Porcherie 1'),
    productName: 'Virkon S',
  });
  await post('/biosecurity-logs', {
    date: ago(1),
    type: 'VISITEUR',
    visitorName: 'Inspecteur vétérinaire de la préfecture',
    note: 'Visite de routine',
  });
  await post('/incidents', {
    date: ago(5),
    title: 'Coupure de courant',
    severity: 'MOYENNE',
    buildingId: ctx.buildings.get('Pondoir C'),
    description: 'Deux heures sans ventilation, groupe électrogène démarré.',
  });
  await post('/quarantines', {
    batchId: lots['LC-2026-15'],
    startDate: ago(3),
    reason: 'Suspicion de coccidiose',
  });
}
