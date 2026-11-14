// The rows of the reference screens (docs/reference/screens-text.txt), seeded through the API with the same
// rules a user meets: no future dates, a litter batch for every farrowing with live piglets, one open record
// per sow. Where a rule prevents an exact copy the nearest valid data is seeded; the differences are listed
// in the task report.
import { api, type EnrolledAdmin } from './helpers.ts';

interface Created { id: string; code?: string }

/** A run of equal daily death counts, so no single day trips the daily mortality alert. */
function deathDays(start: string, perDay: number, total: number): { date: string; quantity: number }[] {
  const out: { date: string; quantity: number }[] = [];
  for (let i = 0; out.length * perDay < total; i += 1) {
    const date = new Date(Date.parse(start) + i * 86_400_000).toISOString().slice(0, 10);
    out.push({ date, quantity: Math.min(perDay, total - out.length * perDay) });
  }
  return out;
}

export async function seedReferenceData(admin: EnrolledAdmin, buildings: Map<string, string>): Promise<void> {
  const call = <T = Created>(path: string, method: string, body?: unknown) =>
    api<T>(path, { method, token: admin.token, farmId: admin.farmId, body });
  const post = <T = Created>(path: string, body: unknown) => call<T>(path, 'POST', body);

  const breed = async (name: string, species: 'AVICOLE' | 'PORCIN') => (await post('/breeds', { name, species })).id;
  const cobb = await breed('Cobb 500', 'AVICOLE');
  const ross = await breed('Ross 308', 'AVICOLE');
  const isa = await breed('ISA Brown', 'AVICOLE');
  const largeWhite = await breed('Large White', 'PORCIN');
  const landrace = await breed('Landrace', 'PORCIN');
  const duroc = await breed('Duroc', 'PORCIN');
  const croise = await breed('Croisé', 'PORCIN');

  // Poultry lots: code, type, breed, house, entry, initial count, deaths, average weight (g).
  const lots: Record<string, string> = {};
  const poultry: [string, string, string, string, string, number, number, number, string][] = [
    ['LC-2026-12', 'CHAIR', cobb, 'Poulailler A', '2026-07-10', 5000, 320, 2300, '2026-07-20'],
    ['LC-2026-14', 'CHAIR', cobb, 'Poulailler A', '2026-09-20', 5000, 180, 1450, '2026-10-20'],
    ['LC-2026-15', 'CHAIR', ross, 'Poulailler B', '2026-10-05', 4000, 100, 620, '2026-10-20'],
    ['LP-2026-03', 'PONDEUSE', isa, 'Pondoir C', '2026-03-12', 3000, 150, 1900, '2026-10-20'],
  ];
  for (const [code, type, breedId, building, entryDate, initialCount, deaths, weight, weighed] of poultry) {
    const lot = await post('/batches', {
      species: 'AVICOLE', type, code, breedId, buildingId: buildings.get(building), entryDate, initialCount,
    });
    lots[code] = lot.id;
    // Small daily counts (under the 0.5 % alert), well before today.
    const start = new Date(Date.parse(entryDate) + 2 * 86_400_000).toISOString().slice(0, 10);
    for (const event of deathDays(start, Math.floor(initialCount * 0.004), deaths)) {
      await post(`/batches/${lot.id}/events`, { type: 'MORTALITE', cause: 'Maladie', ...event });
    }
    await post(`/batches/${lot.id}/weighings`, { date: weighed, sampleSize: 50, averageWeightG: weight });
    // The reference's closed lot kept 4 680 birds; closing it at once frees Poulailler A for the next lot.
    if (code === 'LC-2026-12') await post(`/batches/${lot.id}/close`, {});
  }

  // Eggs of the laying lot: date, collected, broken, put in incubation.
  const eggs: [string, number, number, number][] = [
    ['2026-10-18', 2490, 40, 250],
    ['2026-10-19', 2530, 30, 0],
    ['2026-10-20', 2455, 88, 0],
    ['2026-10-21', 2510, 35, 300],
    ['2026-10-22', 2480, 42, 0],
  ];
  for (const [date, collected, broken, toIncubation] of eggs) {
    await post('/egg-production', { batchId: lots['LP-2026-03'], date, collected, broken, toIncubation });
  }

  // Pigs: animals with their weights, then the services and the lot.
  const animal = async (tag: string, category: string, breedId: string, building: string, birthDate: string, weightKg: number) => {
    const a = await post('/animals', { tag, category, breedId, buildingId: buildings.get(building), birthDate });
    await post(`/animals/${a.id}/weighings`, { date: '2026-10-20', weightKg });
    return a.id;
  };
  const tr014 = await animal('TR-014', 'TRUIE', largeWhite, 'Maternité', '2024-02-10', 210);
  const tr021 = await animal('TR-021', 'TRUIE', landrace, 'Maternité', '2024-05-03', 195);
  const tr027 = await animal('TR-027', 'TRUIE', largeWhite, 'Maternité', '2024-08-19', 180);
  const vr002 = await animal('VR-002', 'VERRAT', duroc, 'Porcherie 1', '2023-11-01', 260);

  // 229 fattening pigs so that, with 4 animals and the 12 live piglets of the farrowing below, the herd is 245.
  const fattening = await post('/batches', {
    species: 'PORCIN', type: 'ENGRAISSEMENT', code: 'LOT-ENG-07', breedId: croise,
    buildingId: buildings.get('Porcherie 1'), entryDate: '2026-05-15', initialCount: 229,
  });
  await post(`/batches/${fattening.id}/weighings`, { date: '2026-10-20', sampleSize: 20, averageWeightG: 68000 });

  await post('/breeding', { sowId: tr014, method: 'SAILLIE', boarId: vr002, serviceDate: '2026-07-05' });
  const ia = await post('/breeding', { sowId: tr021, method: 'IA', semenLabel: 'Duroc', serviceDate: '2026-05-20' });
  await post(`/breeding/${ia.id}/farrowing`, {
    date: '2026-09-11', bornTotal: 13, bornAlive: 12, stillborn: 1, buildingId: buildings.get('Maternité'),
  });
  await post('/breeding', { sowId: tr027, method: 'SAILLIE', boarId: vr002, serviceDate: '2026-10-10' });

  // Feed: products, then the four distributions with their water.
  const product = async (name: string, unitCost: number) => (await post('/feed-products', { name, kind: 'ALIMENT_COMPLET', unitCost })).id;
  const croissance = await product('Croissance chair', 340);
  const ponte1 = await product('Ponte phase 1', 310);
  const engraissement = await product('Engraissement porc', 280);
  const demarrage = await product('Démarrage chair', 380);
  const feed: [string, string, string, number, number][] = [
    ['2026-10-21', 'batchId:LC-2026-15', demarrage, 280, 600],
    ['2026-10-22', 'batchId:LC-2026-14', croissance, 620, 1250],
    ['2026-10-22', 'batchId:LP-2026-03', ponte1, 360, 720],
    ['2026-10-22', 'buildingId:Porcherie 1', engraissement, 540, 1800],
  ];
  for (const [date, target, feedProductId, quantityKg, waterLiters] of feed) {
    const [key, name] = target.split(':');
    await post('/feed-distributions', {
      date, [key]: key === 'batchId' ? lots[name] : buildings.get(name), feedProductId, quantityKg, waterLiters,
    });
  }
}
