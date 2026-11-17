// Sites, buildings, poultry lots with their deaths, weighings, eggs and incubations, the pig herd with breeding, and
// feed. The rows are those of the reference screens (m_batiments, m_lots, m_ponte, m_porcs, m_reproduction,
// m_alimentation) with the rules a user meets: no future dates, a litter lot for every farrowing with live piglets,
// one open record per sow. Where a rule prevents an exact copy the nearest valid data is seeded (see seed-demo.ts).
import { addDays, formatDay, requireDay } from '../../src/common/days';
import type { DemoContext } from './demo-client';
import { ago, ref } from './demo-dates';

export interface ProductionIds {
  lots: Record<string, string>;
  animals: Record<string, string>;
  /** Lots by code, as the sales and health steps need them. */
  products: Record<string, string>;
}

/** A run of equal daily death counts, so no single day trips the daily mortality alert. */
function deathDays(
  start: string,
  perDay: number,
  total: number,
): { date: string; quantity: number }[] {
  const out: { date: string; quantity: number }[] = [];
  for (let i = 0; out.length * perDay < total; i += 1) {
    out.push({
      date: formatDay(addDays(requireDay(start), i)),
      quantity: Math.min(perDay, total - out.length * perDay),
    });
  }
  return out;
}

export async function seedPremises(ctx: DemoContext): Promise<void> {
  const { api } = ctx;
  const site = async (name: string) => (await api.post('/sites', { name })).id;
  const nord = await site('Site Nord');
  const sud = await site('Site Sud');
  await site('Incubation');
  const building = async (
    name: string,
    type: string,
    siteId: string,
    capacity: number,
    status = 'ACTIF',
  ) => {
    ctx.buildings.set(
      name,
      (await api.post('/buildings', { name, type, siteId, capacity, status }))
        .id,
    );
  };
  await building('Poulailler A', 'AVICOLE', nord, 5000);
  await building('Poulailler B', 'AVICOLE', nord, 5000);
  await building('Pondoir C', 'AVICOLE', nord, 3000);
  await building('Porcherie 1', 'PORCIN', sud, 300);
  await building('Porcherie 2', 'PORCIN', sud, 300, 'VIDE_SANITAIRE');
  await building('Maternité', 'PORCIN', sud, 40);
  // Zones: the sub-divisions of two buildings.
  for (const [name, zone, capacity] of [
    ['Poulailler A', 'Zone 1', 2500],
    ['Poulailler A', 'Zone 2', 2500],
    ['Maternité', 'Loge 1', 20],
    ['Maternité', 'Loge 2', 20],
  ] as const) {
    await api.post('/zones', {
      buildingId: ctx.buildings.get(name),
      name: zone,
      capacity,
    });
  }
}

export async function seedProduction(
  ctx: DemoContext,
  palmier: string,
): Promise<ProductionIds> {
  const { api, buildings } = ctx;
  const post = api.post.bind(api);
  const breed = async (name: string, species: 'AVICOLE' | 'PORCIN') =>
    (await post('/breeds', { name, species })).id;
  const cobb = await breed('Cobb 500', 'AVICOLE');
  const ross = await breed('Ross 308', 'AVICOLE');
  const isa = await breed('ISA Brown', 'AVICOLE');
  const largeWhite = await breed('Large White', 'PORCIN');
  const landrace = await breed('Landrace', 'PORCIN');
  const duroc = await breed('Duroc', 'PORCIN');
  const croise = await breed('Croisé', 'PORCIN');

  // Poultry lots: code, type, breed, house, entry, initial count, deaths, average weight (g), weighing day.
  const lots: Record<string, string> = {};
  const poultry: [
    string,
    string,
    string,
    string,
    string,
    number,
    number,
    number,
    string,
  ][] = [
    [
      'LC-2026-12',
      'CHAIR',
      cobb,
      'Poulailler A',
      '2026-07-10',
      5000,
      320,
      2300,
      '2026-07-20',
    ],
    [
      'LC-2026-14',
      'CHAIR',
      cobb,
      'Poulailler A',
      '2026-09-20',
      5000,
      180,
      1450,
      '2026-10-20',
    ],
    // 25 of its 100 deaths come the day before the demo is loaded (the daily mortality alert); the rest are spread early.
    [
      'LC-2026-15',
      'CHAIR',
      ross,
      'Poulailler B',
      '2026-10-05',
      4000,
      75,
      620,
      '2026-10-20',
    ],
    [
      'LP-2026-03',
      'PONDEUSE',
      isa,
      'Pondoir C',
      '2026-03-12',
      3000,
      150,
      1900,
      '2026-10-20',
    ],
  ];
  for (const [
    code,
    type,
    breedId,
    building,
    entryDate,
    initialCount,
    deaths,
    weight,
    weighed,
  ] of poultry) {
    const lot = await post('/batches', {
      species: 'AVICOLE',
      type,
      code,
      breedId,
      buildingId: buildings.get(building),
      entryDate: ref(entryDate),
      initialCount,
    });
    lots[code] = lot.id;
    // Small daily counts (under the 0.5 % alert), well before today.
    const start = formatDay(addDays(requireDay(ref(entryDate)), 2));
    for (const event of deathDays(
      start,
      Math.floor(initialCount * 0.004),
      deaths,
    )) {
      await post(`/batches/${lot.id}/events`, {
        type: 'MORTALITE',
        cause: 'Maladie',
        ...event,
      });
    }
    await post(`/batches/${lot.id}/weighings`, {
      date: ref(weighed),
      sampleSize: 50,
      averageWeightG: weight,
    });
    // The closed lot of the reference kept 4 680 birds: they are sold first (the closed lot then reads 0 alive), 300
    // of them on invoice FA-0310 issued while the lot is still open, the others through the `VENTE` event; closing
    // the lot frees Poulailler A for the next one.
    if (code === 'LC-2026-12') {
      await post(`/batches/${lot.id}/events`, {
        type: 'VENTE',
        date: ref('2026-08-31'),
        quantity: initialCount - deaths - 300,
      });
      await ctx.setCounter('FA', 309);
      await post('/sales/issued', {
        customerId: palmier,
        date: ref('2026-10-21'),
        lines: [
          {
            kind: 'LOT',
            batchId: lot.id,
            designation: 'Poulets de chair',
            quantity: 300,
            unitPrice: 3500,
          },
        ],
        payment: { amount: 1050000, method: 'ESPECES' },
      });
      await post(`/batches/${lot.id}/close`, {});
    }
  }
  // The deaths of yesterday: 25 of the 3 900 chicks alive, 0.64 % of the flock (daily threshold 0.5 %).
  await post(`/batches/${lots['LC-2026-15']}/events`, {
    type: 'MORTALITE',
    cause: 'Coup de chaleur',
    date: ago(1),
    quantity: 25,
  });

  // Eggs of the laying lot: date, collected, broken, put in incubation. 17 extra days before the reference ones give
  // FA-0309 (400 trays = 12 000 eggs) eggs to be sold from.
  for (let d = 1; d <= 17; d += 1) {
    await post('/egg-production', {
      batchId: lots['LP-2026-03'],
      date: ref(`2026-10-${String(d).padStart(2, '0')}`),
      collected: 1500,
      broken: 20,
      toIncubation: 0,
    });
  }
  const eggs: [string, number, number, number][] = [
    ['2026-10-18', 2490, 40, 250],
    ['2026-10-19', 2530, 30, 0],
    ['2026-10-20', 2455, 88, 0],
    ['2026-10-21', 2510, 35, 300],
    ['2026-10-22', 2480, 42, 0],
  ];
  for (const [date, collected, broken, toIncubation] of eggs) {
    await post('/egg-production', {
      batchId: lots['LP-2026-03'],
      date: ref(date),
      collected,
      broken,
      toIncubation,
    });
  }
  // The 250 eggs put in incubation on the 18th: set in the incubator, candled a week later.
  const incubation = await post('/incubations', {
    sourceBatchId: lots['LP-2026-03'],
    incubator: 'Couveuse 1200 œufs',
    startDate: ref('2026-10-18'),
    eggsSet: 250,
  });
  await post(`/incubations/${incubation.id}/candling`, {
    date: ref('2026-10-25'),
    fertileEggs: 228,
  });

  // Pigs: animals with their weights, then the services and the lot.
  const animal = async (
    tag: string,
    category: string,
    breedId: string,
    building: string,
    birthDate: string,
    weightKg: number,
  ) => {
    const a = await post('/animals', {
      tag,
      category,
      breedId,
      buildingId: buildings.get(building),
      birthDate: ref(birthDate),
    });
    await post(`/animals/${a.id}/weighings`, {
      date: ref('2026-10-20'),
      weightKg,
    });
    return a.id;
  };
  const tr014 = await animal(
    'TR-014',
    'TRUIE',
    largeWhite,
    'Maternité',
    '2024-02-10',
    210,
  );
  const tr021 = await animal(
    'TR-021',
    'TRUIE',
    landrace,
    'Maternité',
    '2024-05-03',
    195,
  );
  const tr027 = await animal(
    'TR-027',
    'TRUIE',
    largeWhite,
    'Maternité',
    '2024-08-19',
    180,
  );
  const vr002 = await animal(
    'VR-002',
    'VERRAT',
    duroc,
    'Porcherie 1',
    '2023-11-01',
    260,
  );

  // 251 fattening pigs: 12 leave on FA-0305 and 10 of the 12 piglets on FA-0301, so that with the 4 animals the herd is
  // 4 + 239 + 2 = 245.
  const fattening = await post('/batches', {
    species: 'PORCIN',
    type: 'ENGRAISSEMENT',
    code: 'LOT-ENG-07',
    breedId: croise,
    buildingId: buildings.get('Porcherie 1'),
    entryDate: ref('2026-05-15'),
    initialCount: 251,
  });
  lots['LOT-ENG-07'] = fattening.id;
  await post(`/batches/${fattening.id}/weighings`, {
    date: ref('2026-10-20'),
    sampleSize: 20,
    averageWeightG: 68000,
  });

  await post('/breeding', {
    sowId: tr014,
    method: 'SAILLIE',
    boarId: vr002,
    serviceDate: ref('2026-07-05'),
  });
  const ia = await post('/breeding', {
    sowId: tr021,
    method: 'IA',
    semenLabel: 'Duroc',
    serviceDate: ref('2026-05-20'),
  });
  await post(`/breeding/${ia.id}/farrowing`, {
    date: ref('2026-09-11'),
    bornTotal: 13,
    bornAlive: 12,
    stillborn: 1,
    buildingId: buildings.get('Maternité'),
  });
  await post('/breeding', {
    sowId: tr027,
    method: 'SAILLIE',
    boarId: vr002,
    serviceDate: ref('2026-10-10'),
  });

  // Feed: products, then the four distributions with their water, preceded by the earlier days of the chicks of
  // LC-2026-15 (a smaller ration), so that the day of the 21st reads as a deviation from their average.
  const product = async (name: string, unitCost: number) =>
    (await post('/feed-products', { name, kind: 'ALIMENT_COMPLET', unitCost }))
      .id;
  const croissance = await product('Croissance chair', 340);
  const ponte1 = await product('Ponte phase 1', 310);
  const engraissement = await product('Engraissement porc', 280);
  const demarrage = await product('Démarrage chair', 380);
  for (const d of ['2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18']) {
    await post('/feed-distributions', {
      date: ref(d),
      batchId: lots['LC-2026-15'],
      feedProductId: demarrage,
      quantityKg: 150,
      waterLiters: 330,
    });
  }
  const feed: [string, string, string, number, number][] = [
    ['2026-10-21', 'batchId:LC-2026-15', demarrage, 280, 600],
    ['2026-10-22', 'batchId:LC-2026-14', croissance, 620, 1250],
    ['2026-10-22', 'batchId:LP-2026-03', ponte1, 360, 720],
    ['2026-10-22', 'buildingId:Porcherie 1', engraissement, 540, 1800],
  ];
  for (const [date, target, feedProductId, quantityKg, waterLiters] of feed) {
    const [key, name] = target.split(':');
    await post('/feed-distributions', {
      date: ref(date),
      [key]: key === 'batchId' ? lots[name] : buildings.get(name),
      feedProductId,
      quantityKg,
      waterLiters,
    });
  }
  // The last days: a steady ration for LC-2026-14, then a day above its average (the consumption alert looks at the farm's
  // latest recorded day, today or yesterday).
  for (const n of [5, 4, 3, 2]) {
    await post('/feed-distributions', {
      date: ago(n),
      batchId: lots['LC-2026-14'],
      feedProductId: croissance,
      quantityKg: 600,
      waterLiters: 1200,
    });
  }
  await post('/feed-distributions', {
    date: ago(1),
    batchId: lots['LC-2026-14'],
    feedProductId: croissance,
    quantityKg: 1100,
    waterLiters: 2300,
  });
  return {
    lots,
    animals: { 'TR-014': tr014, 'TR-021': tr021, 'TR-027': tr027 },
    products: { demarrage, croissance, ponte1, engraissement },
  };
}
