// Customers, quotes, invoices (cash, partial, credit, draft, cancelled), a credit note and the manual finance entries:
// the rows of m_clients, m_ventes and m_finance plus one of each state the reference does not show. The invoices
// are issued with their payment, as a user does; the numbers are reached by moving the `FA` counter (no API sets
// one): FA-0310 is issued with the lot (demo-production.ts).
import type { DemoContext } from './demo-client';
import { ago, ref } from './demo-dates';
import type { ProductionIds } from './demo-production';

export interface Customers {
  palmier: string;
  afi: string;
  ramco: string;
  lac: string;
  kossi: string;
}

export async function seedCustomers(ctx: DemoContext): Promise<Customers> {
  const create = async (
    name: string,
    type: string,
    phone: string,
    city: string,
  ) => (await ctx.api.post('/customers', { name, type, phone, city })).id;
  return {
    palmier: await create(
      'Restaurant Le Palmier',
      'RESTAURANT',
      '+228 93 12 34 56',
      'Lomé',
    ),
    afi: await create(
      'Marché Hédzranawoé — Mme Afi',
      'REVENDEUR',
      '+228 98 65 43 21',
      'Lomé',
    ),
    ramco: await create(
      'SuperMarché Ramco',
      'GROSSISTE',
      '+228 22 21 00 00',
      'Lomé',
    ),
    lac: await create('Hôtel Le Lac', 'RESTAURANT', '+228 22 44 55 66', 'Lomé'),
    kossi: await create(
      'M. Kossi Agbéko',
      'PARTICULIER',
      '+228 90 55 44 33',
      'Kpalimé',
    ),
  };
}

interface InvoiceDetail {
  id: string;
  lines: { id: string }[];
}

export async function seedCommerce(
  ctx: DemoContext,
  production: ProductionIds,
  customers: Customers,
): Promise<void> {
  const { api } = ctx;
  const post = api.post.bind(api);

  const litter = (
    await api.list<{ id: string; code: string }>('/batches?species=PORCIN')
  ).find((b) => b.code !== 'LOT-ENG-07');
  if (!litter) throw new Error('Le lot de la portée est introuvable');
  const sale = async (
    last: number,
    customerId: string,
    date: string,
    line: object,
    paid: number,
  ) => {
    await ctx.setCounter('FA', last);
    await post('/sales/issued', {
      customerId,
      date,
      lines: [line],
      payment: { amount: paid, method: 'ESPECES' },
    });
  };
  await sale(
    300,
    customers.palmier,
    ref('2026-10-05'),
    {
      kind: 'LOT',
      batchId: litter.id,
      designation: 'Porcelets',
      quantity: 10,
      unitPrice: 30000,
    },
    300000,
  );
  await sale(
    304,
    customers.ramco,
    ref('2026-10-12'),
    {
      kind: 'LOT',
      batchId: production.lots['LOT-ENG-07'],
      designation: 'Porcs',
      quantity: 12,
      unitPrice: 135000,
    },
    1620000,
  );
  await sale(
    308,
    customers.afi,
    ref('2026-10-20'),
    {
      kind: 'OEUFS',
      batchId: production.lots['LP-2026-03'],
      unit: 'PLATEAU',
      quantity: 400,
      unitPrice: 2500,
    },
    600000,
  );

  // Beyond the reference (FA-0311 onwards): a partial payment then a credit note, a cancelled invoice, and quotes.
  await ctx.setCounter('FA', 310);
  const partial = await post<{ id: string }>('/sales/issued', {
    customerId: customers.lac,
    date: ago(6),
    dueDate: ago(-9),
    lines: [
      {
        kind: 'OEUFS',
        batchId: production.lots['LP-2026-03'],
        unit: 'PLATEAU',
        quantity: 100,
        unitPrice: 2500,
      },
    ],
    payment: { amount: 100000, method: 'MOBILE_MONEY', reference: 'MM-55671' },
  });
  const detail = await api.get<InvoiceDetail>(`/sales/${partial.id}`);
  await post(`/sales/${partial.id}/credit-notes`, {
    date: ago(3),
    reason: 'Plateaux cassés au transport',
    lines: [{ lineId: detail.lines[0].id, quantity: 10 }],
  });
  const cancelled = await post<{ id: string }>('/sales/issued', {
    customerId: customers.kossi,
    date: ago(5),
    lines: [
      {
        kind: 'SERVICE',
        designation: 'Livraison à domicile',
        quantity: 1,
        unitPrice: 25000,
      },
    ],
  });
  await post(`/sales/${cancelled.id}/cancel`, {
    reason: 'Commande annulée par le client',
  });

  const quote = (customerId: string, validUntil: string, line: object) =>
    post<{ id: string }>('/quotes', {
      customerId,
      date: ago(8),
      validUntil,
      lines: [line],
    });
  const draft = await quote(customers.lac, ago(-20), {
    kind: 'LOT',
    batchId: production.lots['LC-2026-14'],
    designation: 'Poulets de chair',
    quantity: 200,
    unitPrice: 3600,
  });
  void draft;
  const sent = await quote(customers.palmier, ago(-14), {
    kind: 'LOT',
    batchId: production.lots['LC-2026-14'],
    designation: 'Poulets de chair',
    quantity: 150,
    unitPrice: 3500,
  });
  await post(`/quotes/${sent.id}/send`);
  const refused = await quote(customers.ramco, ago(-10), {
    kind: 'LOT',
    batchId: production.lots['LOT-ENG-07'],
    designation: 'Porcs',
    quantity: 20,
    unitPrice: 130000,
  });
  await post(`/quotes/${refused.id}/send`);
  await post(`/quotes/${refused.id}/refuse`);
  const accepted = await quote(customers.kossi, ago(-5), {
    kind: 'SERVICE',
    designation: 'Fumier (livraison)',
    quantity: 4,
    unitPrice: 15000,
  });
  await post(`/quotes/${accepted.id}/send`);
  await post(`/quotes/${accepted.id}/accept`);
  await post(`/quotes/${accepted.id}/convert`);
}

export async function seedFinance(
  ctx: DemoContext,
  production: ProductionIds,
): Promise<void> {
  const post = ctx.api.post.bind(ctx.api);
  const entry = (
    date: string,
    kind: string,
    label: string,
    activity: string,
    category: string,
    amount: number,
    extra: object = {},
  ) =>
    post('/finance/entries', {
      date,
      kind,
      label,
      activity,
      category,
      amount,
      ...extra,
    });
  await entry(
    ref('2026-10-01'),
    'DEPENSE',
    'Salaires septembre',
    'GENERAL',
    'SALAIRES',
    950000,
  );
  await entry(
    ref('2026-10-03'),
    'DEPENSE',
    'Aliment chair 6 t',
    'AVICOLE',
    'ALIMENT',
    1020000,
  );
  await entry(
    ref('2026-10-08'),
    'DEPENSE',
    'Électricité CEET',
    'GENERAL',
    'ENERGIE',
    185000,
  );
  await entry(
    ref('2026-10-10'),
    'DEPENSE',
    'Vaccins & médicaments',
    'AVICOLE',
    'SANTE',
    120000,
  );
  await entry(
    ref('2026-10-14'),
    'DEPENSE',
    'Aliment porc 2 t',
    'PORCIN',
    'ALIMENT',
    560000,
  );
  // Beyond the reference: the chicks of a lot (a lot cost), a transport expense and a manual receipt.
  await entry(
    ref('2026-10-05'),
    'DEPENSE',
    'Poussins LC-2026-15',
    'AVICOLE',
    'ANIMAUX',
    380000,
    { batchId: production.lots['LC-2026-15'] },
  );
  await entry(
    ago(7),
    'DEPENSE',
    'Transport des œufs',
    'AVICOLE',
    'TRANSPORT',
    42000,
  );
  await entry(
    ago(4),
    'RECETTE',
    'Vente de fientes (engrais)',
    'AVICOLE',
    'VENTE_ARTICLES',
    60000,
  );
}
