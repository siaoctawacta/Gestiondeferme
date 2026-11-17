import { INestApplication } from '@nestjs/common';
import { parseDay, formatDay } from '../src/common/days';
import {
  nextMaintenance,
  type ConditionValue,
} from '../src/equipment/equipment-state';
import { EquipmentAlertsService } from '../src/equipment/equipment-alerts.service';
import { MaintenanceService } from '../src/equipment/maintenance.service';
import { PrismaService } from '../src/prisma/prisma.service';
import type { RequestContext } from '../src/access/decorators';
import { daysAgo, Headers, Id, Msg, World } from './fixtures';
import { countQueries } from './query-counter';
import { createFarm, createTestApp, createUser, tokenFor } from './setup';

interface Breakdown {
  id: string;
  date: string;
  description: string;
  repairId: string | null;
  resolvedDate: string | null;
}
interface Item extends Id {
  name: string;
  type: string;
  location: string | null;
  siteId: string | null;
  buildingId: string | null;
  condition: ConditionValue;
  nextMaintenance: string | null;
  maintenanceDue: boolean;
  retiredAt: string | null;
  openBreakdown: { id: string; date: string; description: string } | null;
  hasHistory: boolean;
  maintenanceIntervalDays: number | null;
}
interface Detail extends Item {
  brand: string | null;
  serialNumber: string | null;
  purchaseDate: string | null;
  firstMaintenanceDate: string | null;
  note: string | null;
  interventions: Intervention[];
  breakdowns: Breakdown[];
  openTasks: number;
  maintenanceCost: number | null;
}
interface Intervention extends Id {
  date: string;
  equipmentId: string;
  equipmentName: string;
  kind: string;
  description: string;
  performedBy: string | null;
  supplierId: string | null;
  supplierName: string | null;
  cost: number | null;
  nextDate: string | null;
  repairs: boolean;
}
interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  statusCounts?: Record<string, number>;
}
interface AlertsBody {
  total: number;
  items: { key: string; title: string; detail: string; level: string }[];
}
interface FinanceRow extends Id {
  origin: string;
  date: string;
  label: string;
  kind: string;
  activity: string;
  category: string;
  amount: number;
  sourceId: string | null;
  editable: boolean;
}

const NAME_TAKEN = 'Un équipement porte déjà ce nom dans cette ferme';
const BOTH = 'Indiquez un site ou un bâtiment, pas les deux';
const HISTORY = 'Cet équipement a un historique : réformez-le';
const RETIRED = 'Équipement réformé';
const ALREADY_BROKEN = 'Une panne est déjà déclarée pour cet équipement';
const NOT_CORRECTIVE = 'Seule une intervention corrective répare une panne';
const NO_OPEN = 'Aucune panne ouverte sur cet équipement';
const BEFORE_BREAKDOWN = "L'intervention précède la panne";
const OTHER_OPEN = "Une autre panne est ouverte : réparez-la d'abord";
const EQUIPMENT_INVALID = 'Équipement invalide pour cette ferme';
const SUPPLIER_INVALID = 'Fournisseur invalide';
const BY_HAND = "L'état « En panne » se déclare par une panne";
const BY_INTERVENTION =
  'Un équipement en panne est remis en service par une intervention corrective';
const FUTURE = 'La date ne peut pas être dans le futur';
const DERIVED =
  "Cette écriture provient d'un document ; corrigez le document d'origine";

const GROUPE = 'Groupe électrogène 20 kVA';
const COUVEUSE = 'Couveuse 1200 œufs';
const POMPE = 'Pompe forage';
const VENTILATEUR = 'Ventilateur Poulailler B #3';

describe('Équipements et maintenance (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let world: World;
  let director: Headers;
  let poultry: Headers;
  let agent: Headers;
  let accountant: Headers;
  let siteNord: string;
  let siteIncubation: string;
  let siteSud: string;
  let poulaillerB: string;
  let groupe: Item;
  let couveuse: Item;
  let pompe: Item;
  let ventilateur: Item;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = new PrismaService();
    world = new World(app, prisma);
  });

  beforeEach(async () => {
    await world.reset();
    director = await world.actor('DIRECTEUR_FERME');
    poultry = await world.actor('RESP_AVICOLE');
    agent = await world.actor('AGENT_ELEVAGE');
    accountant = await world.actor('COMPTABLE');
    const site = (name: string) =>
      prisma.site
        .create({ data: { farmId: world.farmId, name } })
        .then((s) => s.id);
    siteNord = await site('Site Nord');
    siteIncubation = await site('Incubation');
    siteSud = await site('Site Sud');
    poulaillerB = (
      await prisma.building.create({
        data: {
          farmId: world.farmId,
          siteId: world.siteId,
          name: 'Poulailler B',
          type: 'AVICOLE',
          capacity: 5000,
        },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  const http = () => world.http();
  const message = (res: { message: string | string[] }) => res.message;
  const make = (body: Record<string, unknown>, h = director) =>
    world.post<Item>(h, '/equipment', body);
  const refuse = (
    method: 'post' | 'patch' | 'delete',
    path: string,
    body: object,
    status: number,
    h = director,
  ) =>
    http()
      [method](`/api${path}`)
      .set(h)
      .send(body)
      .expect(status)
      .then((res) => res.body as Msg);
  const get = (id: string, h = director) =>
    http()
      .get(`/api/equipment/${id}`)
      .set(h)
      .expect(200)
      .then((res) => res.body as Detail);
  const list = (query = '', h = director) =>
    http()
      .get(`/api/equipment${query}`)
      .set(h)
      .expect(200)
      .then((res) => res.body as Page<Item>);
  const patch = (id: string, body: object, status = 200, h = director) =>
    http()
      .patch(`/api/equipment/${id}`)
      .set(h)
      .send(body)
      .expect(status)
      .then((res) => res.body as Item & Msg);
  const declare = (
    id: string,
    body: object = { date: daysAgo(2), description: 'Moteur grillé' },
    status = 201,
    h = agent,
  ) =>
    http()
      .post(`/api/equipment/${id}/breakdowns`)
      .set(h)
      .send(body)
      .expect(status)
      .then((res) => res.body as Breakdown & Msg);
  const intervene = (
    body: Record<string, unknown>,
    status = 201,
    h = director,
  ) =>
    http()
      .post('/api/maintenance')
      .set(h)
      .send({
        kind: 'PREVENTIVE',
        date: daysAgo(1),
        description: 'Contrôle',
        ...body,
      })
      .expect(status)
      .then((res) => res.body as Intervention & Msg);
  const patchIntervention = (
    id: string,
    body: object,
    status = 200,
    h = director,
  ) =>
    http()
      .patch(`/api/maintenance/${id}`)
      .set(h)
      .send(body)
      .expect(status)
      .then((res) => res.body as Intervention & Msg);
  const removeIntervention = (id: string, status = 200, h = director) =>
    http()
      .delete(`/api/maintenance/${id}`)
      .set(h)
      .expect(status)
      .then((res) => res.body as Msg);
  const interventions = (query = '', h = director) =>
    http()
      .get(`/api/maintenance${query}`)
      .set(h)
      .expect(200)
      .then((res) => res.body as Page<Intervention>);
  const audit = () =>
    prisma.auditLog.findMany({
      where: { module: 'equipements' },
      orderBy: { createdAt: 'asc' },
    });
  const alerts = async (h = director) =>
    (
      (await http().get('/api/alerts').set(h).expect(200)).body as AlertsBody
    ).items
      .filter((a) => /^(breakdown|maintenance):/.test(a.key))
      .map(({ key, title, detail, level }) => ({ key, title, detail, level }));
  const entries = async (query = 'origin=MAINTENANCE', h = director) =>
    (
      (await http().get(`/api/finance/entries?${query}`).set(h).expect(200))
        .body as Page<FinanceRow>
    ).items;
  const expenses = async () =>
    (
      (await http().get('/api/finance/summary').set(director).expect(200))
        .body as { expenses: number }
    ).expenses;

  /** The four reference equipment, relative to the real clock (the dues of the reference are 15, 20 and 25 days old). */
  const reference = async () => {
    groupe = await make({
      name: GROUPE,
      type: 'GROUPE_ELECTROGENE',
      siteId: siteNord,
      firstMaintenanceDate: daysAgo(15),
    });
    couveuse = await make({
      name: COUVEUSE,
      type: 'COUVEUSE',
      siteId: siteIncubation,
      firstMaintenanceDate: daysAgo(20),
    });
    await patch(couveuse.id, { condition: 'A_SURVEILLER' });
    pompe = await make({
      name: POMPE,
      type: 'POMPE',
      siteId: siteSud,
      firstMaintenanceDate: daysAgo(-1),
    });
    ventilateur = await make({
      name: VENTILATEUR,
      type: 'VENTILATEUR',
      buildingId: poulaillerB,
      firstMaintenanceDate: daysAgo(25),
    });
    await declare(ventilateur.id, {
      date: daysAgo(12),
      description: 'Moteur grillé',
    });
  };

  /** The cache of the next maintenance equals the recomputation from the interventions. */
  const expectCacheExact = async (id: string) => {
    const row = await prisma.equipment.findUniqueOrThrow({
      where: { id },
      include: { maintenances: true },
    });
    const expected = nextMaintenance(
      {
        firstMaintenanceDate: row.firstMaintenanceDate
          ? formatDay(row.firstMaintenanceDate)
          : null,
        maintenanceIntervalDays: row.maintenanceIntervalDays,
      },
      row.maintenances.map((m) => ({
        date: formatDay(m.date),
        nextDate: m.nextDate ? formatDay(m.nextDate) : null,
        createdAt: m.createdAt,
      })),
    );
    expect(
      row.nextMaintenanceDate ? formatDay(row.nextMaintenanceDate) : null,
    ).toBe(expected);
  };

  describe('the list', () => {
    it('lists the reference equipment with their locations, states and the status counts', async () => {
      await reference();
      const page = await list();
      expect(page.total).toBe(4);
      expect(page.statusCounts).toEqual({
        BON: 2,
        A_SURVEILLER: 1,
        EN_PANNE: 1,
      });
      expect(page.items.map((i) => [i.name, i.location])).toEqual([
        [COUVEUSE, 'Incubation'],
        [GROUPE, 'Site Nord'],
        [POMPE, 'Site Sud'],
        [VENTILATEUR, 'Poulailler B'],
      ]);
      const row = (name: string) =>
        page.items.find((i) => i.name === name) as Item;
      expect(row(VENTILATEUR)).toMatchObject({
        type: 'VENTILATEUR',
        siteId: null,
        buildingId: poulaillerB,
        condition: 'EN_PANNE',
        nextMaintenance: daysAgo(25),
        maintenanceDue: true,
        retiredAt: null,
        hasHistory: true,
        maintenanceIntervalDays: null,
        openBreakdown: { description: 'Moteur grillé', date: daysAgo(12) },
      });
      expect(row(VENTILATEUR).openBreakdown?.id).toEqual(expect.any(String));
      expect(row(COUVEUSE)).toMatchObject({
        condition: 'A_SURVEILLER',
        openBreakdown: null,
        hasHistory: false,
        maintenanceDue: true,
      });
      expect(row(GROUPE)).toMatchObject({ siteId: siteNord, buildingId: null });
      expect(row(POMPE)).toMatchObject({
        nextMaintenance: daysAgo(-1),
        maintenanceDue: false,
      });
    });

    it('filters by status, type and search, and counts the statuses over the other filters', async () => {
      await reference();
      const broken = await list('?status=EN_PANNE');
      expect(broken.items.map((i) => i.name)).toEqual([VENTILATEUR]);
      expect(broken.statusCounts).toEqual({
        BON: 2,
        A_SURVEILLER: 1,
        EN_PANNE: 1,
      });
      expect((await list('?type=POMPE')).items.map((i) => i.name)).toEqual([
        POMPE,
      ]);
      const searched = await list('?search=couveuse');
      expect(searched.items.map((i) => i.name)).toEqual([COUVEUSE]);
      expect(searched.statusCounts).toEqual({
        BON: 0,
        A_SURVEILLER: 1,
        EN_PANNE: 0,
      });
      await http().get('/api/equipment?status=CASSE').set(director).expect(400);
      await http().get('/api/equipment?type=CASSE').set(director).expect(400);
    });

    it('sorts by name or by the cached next maintenance, equipment without one last', async () => {
      await reference();
      await make({ name: 'Balance', type: 'BALANCE' });
      const byDate = await list('?sort=nextMaintenance:asc');
      expect(byDate.items.map((i) => i.name)).toEqual([
        VENTILATEUR,
        COUVEUSE,
        GROUPE,
        POMPE,
        'Balance',
      ]);
      const desc = await list('?sort=nextMaintenance:desc');
      expect(desc.items.map((i) => i.name)).toEqual([
        POMPE,
        GROUPE,
        COUVEUSE,
        VENTILATEUR,
        'Balance',
      ]);
      const names = await list('?sort=name:desc');
      expect(names.items[0].name).toBe(VENTILATEUR);
      await http()
        .get('/api/equipment?sort=brand:asc')
        .set(director)
        .expect(400);
    });

    it('exports the list', async () => {
      await reference();
      const csv = await http()
        .get('/api/equipment?format=csv')
        .set(director)
        .expect(200);
      const lines = csv.text.replace('﻿', '').split('\r\n');
      expect(lines[0]).toBe(
        'Équipement;Type;Emplacement;Prochaine maintenance;État',
      );
      expect(lines).toContain(
        `${GROUPE};Groupe électrogène;Site Nord;${daysAgo(15)};Bon`,
      );
      expect(lines).toContain(
        `${VENTILATEUR};Ventilateur;Poulailler B;${daysAgo(25)};En panne`,
      );
    });

    it('serves every reader of equipements and refuses the others', async () => {
      await reference();
      expect((await list('', agent)).total).toBe(4);
      expect((await list('', poultry)).total).toBe(4);
      await http().get('/api/equipment').set(accountant).expect(403);
      await http()
        .get('/api/equipment')
        .set(await world.actor('COMMERCIAL'))
        .expect(403);
      expect((await list('', await world.actor('AUDITEUR'))).total).toBe(4);
    });
  });

  describe('the detail', () => {
    it('carries the stored fields, the interventions, the breakdowns, the open tasks and the maintenance cost', async () => {
      const made = await make({
        name: GROUPE,
        type: 'GROUPE_ELECTROGENE',
        siteId: siteNord,
        brand: 'Perkins',
        serialNumber: 'SN-42',
        purchaseDate: daysAgo(400),
        maintenanceIntervalDays: 90,
        firstMaintenanceDate: daysAgo(15),
        note: 'Cuve de 200 L',
      });
      await declare(made.id, { date: daysAgo(10), description: 'Panne sèche' });
      const repair = await intervene({
        equipmentId: made.id,
        kind: 'CORRECTIVE',
        date: daysAgo(9),
        description: 'Plein et purge',
        cost: 12000,
        repairsBreakdown: true,
      });
      const detail = await get(made.id);
      expect(detail).toMatchObject({
        id: made.id,
        name: GROUPE,
        location: 'Site Nord',
        brand: 'Perkins',
        serialNumber: 'SN-42',
        purchaseDate: daysAgo(400),
        maintenanceIntervalDays: 90,
        firstMaintenanceDate: daysAgo(15),
        note: 'Cuve de 200 L',
        condition: 'BON',
        openBreakdown: null,
        hasHistory: true,
        openTasks: 0,
        maintenanceCost: 12000,
      });
      expect(detail.interventions).toEqual([
        {
          id: repair.id,
          date: daysAgo(9),
          equipmentId: made.id,
          equipmentName: GROUPE,
          kind: 'CORRECTIVE',
          description: 'Plein et purge',
          performedBy: null,
          supplierId: null,
          supplierName: null,
          cost: 12000,
          nextDate: null,
          repairs: true,
        },
      ]);
      expect(detail.breakdowns).toEqual([
        {
          id: expect.any(String) as string,
          date: daysAgo(10),
          description: 'Panne sèche',
          repairId: repair.id,
          resolvedDate: daysAgo(9),
        },
      ]);
    });

    it('hides the cost without finance:read and answers 404 for an unknown id', async () => {
      await reference();
      const seen = await get(groupe.id, agent);
      expect(seen.maintenanceCost).toBeNull();
      expect((await get(groupe.id, director)).maintenanceCost).toBe(0);
      await http().get('/api/equipment/nope').set(director).expect(404);
    });
  });

  describe('creating and editing equipment', () => {
    it('creates an equipment without a location, in service, its next maintenance being the first date', async () => {
      const created = await make({
        name: 'Balance',
        type: 'BALANCE',
        firstMaintenanceDate: daysAgo(-30),
      });
      expect(created).toMatchObject({
        name: 'Balance',
        type: 'BALANCE',
        location: null,
        siteId: null,
        buildingId: null,
        condition: 'BON',
        nextMaintenance: daysAgo(-30),
        maintenanceDue: false,
        retiredAt: null,
        hasHistory: false,
        openBreakdown: null,
      });
      await expectCacheExact(created.id);
      const rows = await audit();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        action: 'CREATE',
        recordId: created.id,
        label: 'Balance',
        farmId: world.farmId,
      });
    });

    it('creates at a building, and rejects bad bodies', async () => {
      const inBuilding = await make({
        name: 'Ventilateur',
        type: 'VENTILATEUR',
        buildingId: poulaillerB,
      });
      expect(inBuilding.location).toBe('Poulailler B');
      const bad = async (body: object, status = 400) =>
        message(
          await refuse(
            'post',
            '/equipment',
            { name: 'X', type: 'POMPE', ...body },
            status,
          ),
        );
      expect(await bad({ siteId: siteNord, buildingId: poulaillerB })).toBe(
        BOTH,
      );
      expect(await bad({ name: 'Balance' }, 201)).toBeUndefined();
      expect(await bad({ name: 'Balance' }, 409)).toBe(NAME_TAKEN);
      await bad({ name: '  ' });
      await bad({ name: undefined });
      await bad({ type: 'ROBOT' });
      await bad({ type: undefined });
      await bad({ maintenanceIntervalDays: 0, name: 'Y' });
      await bad({ maintenanceIntervalDays: 1.5, name: 'Y' });
      await bad({ purchaseDate: daysAgo(-1), name: 'Y' });
      await bad({ purchaseDate: 'hier', name: 'Y' });
      await bad({ condition: 'EN_PANNE', name: 'Y' });
      await bad({ siteId: null, name: 'Z' }, 201);
      expect(await prisma.equipment.count()).toBe(3);
    });

    it('refuses a site or a building of another farm, and ids that do not exist', async () => {
      const other = await createFarm(world.orgId, 'Ferme B');
      const foreignSite = await prisma.site.create({
        data: { farmId: other.id, name: 'Site B' },
      });
      const foreignBuilding = await prisma.building.create({
        data: {
          farmId: other.id,
          siteId: foreignSite.id,
          name: 'Bât B',
          type: 'AVICOLE',
          capacity: 10,
        },
      });
      for (const body of [
        { siteId: foreignSite.id },
        { buildingId: foreignBuilding.id },
        { siteId: 'nope' },
        { buildingId: 'nope' },
      ]) {
        await refuse(
          'post',
          '/equipment',
          { name: 'Étranger', type: 'POMPE', ...body },
          400,
        );
      }
      const own = await make({ name: 'Local', type: 'POMPE' });
      await patch(own.id, { siteId: foreignSite.id }, 400);
      await patch(own.id, { buildingId: foreignBuilding.id }, 400);
      expect(await prisma.equipment.count()).toBe(1);
    });

    it('is master data: only update writes (AGENT, RESP_AVICOLE, COMPTABLE, AUDITEUR refused)', async () => {
      const made = await make({ name: 'Balance', type: 'BALANCE' });
      for (const h of [agent, poultry, accountant]) {
        await refuse(
          'post',
          '/equipment',
          { name: 'B2', type: 'AUTRE' },
          403,
          h,
        );
        await refuse('patch', `/equipment/${made.id}`, { note: 'x' }, 403, h);
        await refuse('delete', `/equipment/${made.id}`, {}, 403, h);
        await refuse(
          'post',
          `/equipment/${made.id}/retire`,
          { date: daysAgo(0) },
          403,
          h,
        );
        await refuse('post', `/equipment/${made.id}/reinstate`, {}, 403, h);
      }
      const auditor = await world.actor('AUDITEUR');
      await refuse(
        'post',
        '/equipment',
        { name: 'B3', type: 'AUTRE' },
        403,
        auditor,
      );
      expect(await prisma.equipment.count()).toBe(1);
    });

    it('edits fields, clears the optional ones with null and moves the location', async () => {
      const made = await make({
        name: 'Balance',
        type: 'BALANCE',
        siteId: siteNord,
        brand: 'Mettler',
        serialNumber: 'S1',
        purchaseDate: daysAgo(100),
        maintenanceIntervalDays: 30,
        note: 'x',
      });
      const moved = await patch(made.id, {
        name: 'Balance 2',
        siteId: null,
        buildingId: poulaillerB,
      });
      expect(moved).toMatchObject({
        name: 'Balance 2',
        location: 'Poulailler B',
        siteId: null,
        buildingId: poulaillerB,
      });
      const cleared = await patch(made.id, {
        brand: null,
        serialNumber: null,
        purchaseDate: null,
        maintenanceIntervalDays: null,
        note: null,
        buildingId: null,
      });
      expect(cleared).toMatchObject({
        location: null,
        buildingId: null,
        siteId: null,
        maintenanceIntervalDays: null,
      });
      const detail = await get(made.id);
      expect(detail).toMatchObject({
        brand: null,
        serialNumber: null,
        purchaseDate: null,
        note: null,
      });
      const bothSet = await patch(
        made.id,
        { siteId: siteNord, buildingId: poulaillerB },
        400,
      );
      expect(message(bothSet)).toBe(BOTH);
      // a body that sets one while the other is stored is the merged result: both set
      await patch(made.id, { siteId: siteNord });
      const merged = await patch(made.id, { buildingId: poulaillerB }, 400);
      expect(message(merged)).toBe(BOTH);
      await patch(made.id, { name: null }, 400);
      await patch(made.id, { type: null }, 400);
      await patch(made.id, { condition: null }, 400);
      await patch(made.id, { maintenanceIntervalDays: 0 }, 400);
    });

    it('refuses a name already taken, and writes no audit row for a PATCH that changes nothing', async () => {
      await make({ name: 'A', type: 'AUTRE' });
      const b = await make({ name: 'B', type: 'AUTRE' });
      expect(message(await patch(b.id, { name: 'A' }, 409))).toBe(NAME_TAKEN);
      await patch(b.id, { name: 'B', note: null });
      await patch(b.id, { condition: 'BON' });
      expect((await audit()).filter((r) => r.action === 'UPDATE')).toHaveLength(
        0,
      );
      await patch(b.id, { note: 'a' });
      expect((await audit()).filter((r) => r.action === 'UPDATE')).toHaveLength(
        1,
      );
    });

    it('recomputes the cached next maintenance when the interval or the first date change', async () => {
      const made = await make({
        name: 'Pompe',
        type: 'POMPE',
        firstMaintenanceDate: daysAgo(-10),
      });
      await expectCacheExact(made.id);
      await intervene({ equipmentId: made.id, date: daysAgo(3) });
      // no interval and no next date: nothing is planned any more
      expect((await get(made.id)).nextMaintenance).toBeNull();
      await patch(made.id, { maintenanceIntervalDays: 45 });
      expect((await get(made.id)).nextMaintenance).toBe(
        formatDay(
          new Date((parseDay(daysAgo(3)) as Date).getTime() + 45 * 86_400_000),
        ),
      );
      await expectCacheExact(made.id);
      await patch(made.id, { maintenanceIntervalDays: null });
      expect((await get(made.id)).nextMaintenance).toBeNull();
      await expectCacheExact(made.id);
    });

    it('moves a condition between BON and A_SURVEILLER only', async () => {
      await reference();
      expect(
        message(await patch(groupe.id, { condition: 'EN_PANNE' }, 400)),
      ).toBe(BY_HAND);
      expect(
        message(await patch(ventilateur.id, { condition: 'BON' }, 409)),
      ).toBe(BY_INTERVENTION);
      await patch(ventilateur.id, { condition: 'A_SURVEILLER' }, 409);
      expect(
        (await patch(groupe.id, { condition: 'A_SURVEILLER' })).condition,
      ).toBe('A_SURVEILLER');
      expect((await patch(couveuse.id, { condition: 'BON' })).condition).toBe(
        'BON',
      );
      // the state a broken equipment already has is not a change
      await patch(ventilateur.id, { condition: 'EN_PANNE', note: 'x' });
      expect((await get(ventilateur.id)).condition).toBe('EN_PANNE');
    });
  });

  describe('breakdowns', () => {
    it('declares a breakdown (a daily entry), puts the equipment in panne and refuses a second one', async () => {
      await reference();
      const open = await get(ventilateur.id);
      expect(open.condition).toBe('EN_PANNE');
      expect(open.breakdowns).toHaveLength(1);
      expect(open.breakdowns[0]).toMatchObject({
        date: daysAgo(12),
        description: 'Moteur grillé',
        repairId: null,
        resolvedDate: null,
      });
      const again = await declare(ventilateur.id, undefined, 409);
      expect(message(again)).toBe(ALREADY_BROKEN);
      await declare(
        couveuse.id,
        { date: daysAgo(1), description: 'Fuite' },
        201,
        poultry,
      );
      expect((await get(couveuse.id)).condition).toBe('EN_PANNE');
      const rows = (await audit()).filter((r) => r.label?.includes('Moteur'));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ action: 'CREATE' });
    });

    it('checks the date and the body', async () => {
      const made = await make({
        name: 'Pompe',
        type: 'POMPE',
        purchaseDate: daysAgo(30),
      });
      expect(
        message(
          await declare(made.id, { date: daysAgo(-1), description: 'x' }, 400),
        ),
      ).toBe(FUTURE);
      expect(
        message(
          await declare(made.id, { date: daysAgo(31), description: 'x' }, 400),
        ),
      ).toBe("La date précède l'achat de l'équipement");
      await declare(made.id, { date: daysAgo(2) }, 400);
      await declare(made.id, { date: daysAgo(2), description: '  ' }, 400);
      await declare(made.id, { date: 'hier', description: 'x' }, 400);
      await declare(made.id, {
        date: daysAgo(30),
        description: 'Le jour même',
      });
    });

    it('is open to the roles that create (RESP_AVICOLE, AGENT) and refused to the others', async () => {
      const made = await make({ name: 'Pompe', type: 'POMPE' });
      await declare(made.id, undefined, 403, accountant);
      await declare(made.id, undefined, 403, await world.actor('COMMERCIAL'));
      await declare(made.id, undefined, 403, await world.actor('AUDITEUR'));
      await declare(made.id, undefined, 201, poultry);
    });

    it('refuses a breakdown on a retired equipment and on another farm, with 404', async () => {
      const made = await make({ name: 'Pompe', type: 'POMPE' });
      await http()
        .post(`/api/equipment/${made.id}/retire`)
        .set(director)
        .send({ date: daysAgo(1) })
        .expect(200);
      expect(message(await declare(made.id, undefined, 409))).toBe(RETIRED);
      await declare('nope', undefined, 404);
    });
  });

  describe('interventions', () => {
    it('a preventive intervention with a cost moves the next maintenance and creates a finance expense', async () => {
      await reference();
      const before = await expenses();
      expect((await alerts()).map((a) => a.detail)).toContain(GROUPE);
      const done = await intervene({
        equipmentId: groupe.id,
        kind: 'PREVENTIVE',
        date: daysAgo(7),
        description: 'Vidange',
        cost: 45000,
        nextDate: daysAgo(-83),
        performedBy: 'Atelier Kossi',
      });
      expect(done).toMatchObject({
        equipmentId: groupe.id,
        equipmentName: GROUPE,
        kind: 'PREVENTIVE',
        date: daysAgo(7),
        description: 'Vidange',
        performedBy: 'Atelier Kossi',
        cost: 45000,
        nextDate: daysAgo(-83),
        repairs: false,
        supplierId: null,
        supplierName: null,
      });
      const after = await get(groupe.id);
      expect(after.nextMaintenance).toBe(daysAgo(-83));
      expect(after.maintenanceDue).toBe(false);
      expect(after.maintenanceCost).toBe(45000);
      expect((await alerts()).map((a) => a.detail)).not.toContain(GROUPE);
      await expectCacheExact(groupe.id);
      const rows = await entries();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id: `maintenance:${done.id}`,
        origin: 'MAINTENANCE',
        sourceId: done.id,
        date: daysAgo(7),
        label: `Maintenance ${GROUPE} — Vidange`,
        kind: 'DEPENSE',
        activity: 'GENERAL',
        category: 'ENTRETIEN',
        amount: 45000,
        editable: false,
      });
      expect((await expenses()) - before).toBe(45000);
    });

    it('a corrective intervention that repairs the breakdown puts the equipment back in service, in the activity of its building', async () => {
      await reference();
      const done = await intervene({
        equipmentId: ventilateur.id,
        kind: 'CORRECTIVE',
        date: daysAgo(5),
        description: 'Remplacement moteur',
        cost: 30000,
        repairsBreakdown: true,
      });
      expect(done.repairs).toBe(true);
      const after = await get(ventilateur.id);
      expect(after).toMatchObject({ condition: 'BON', openBreakdown: null });
      expect(after.breakdowns[0]).toMatchObject({
        repairId: done.id,
        resolvedDate: daysAgo(5),
      });
      expect((await alerts()).map((a) => a.key)).not.toContain(
        `breakdown:${ventilateur.id}`,
      );
      const [row] = await entries();
      expect(row).toMatchObject({
        label: `Maintenance ${VENTILATEUR} — Remplacement moteur`,
        activity: 'AVICOLE',
        category: 'ENTRETIEN',
        amount: 30000,
      });
      await expectCacheExact(ventilateur.id);
    });

    it('puts the repaired equipment in the state asked for', async () => {
      await reference();
      await intervene({
        equipmentId: ventilateur.id,
        kind: 'CORRECTIVE',
        date: daysAgo(5),
        description: 'Réparation de fortune',
        repairsBreakdown: true,
        conditionAfter: 'A_SURVEILLER',
      });
      expect((await get(ventilateur.id)).condition).toBe('A_SURVEILLER');
    });

    it('deleting the repairing intervention reopens the breakdown; refused when another one is open', async () => {
      await reference();
      const done = await intervene({
        equipmentId: ventilateur.id,
        kind: 'CORRECTIVE',
        date: daysAgo(5),
        description: 'Remplacement moteur',
        cost: 30000,
        repairsBreakdown: true,
      });
      await removeIntervention(done.id);
      const reopened = await get(ventilateur.id);
      expect(reopened.condition).toBe('EN_PANNE');
      expect(reopened.openBreakdown).toMatchObject({ date: daysAgo(12) });
      expect(reopened.breakdowns[0]).toMatchObject({
        repairId: null,
        resolvedDate: null,
      });
      expect(await entries()).toHaveLength(0);
      await expectCacheExact(ventilateur.id);

      const second = await intervene({
        equipmentId: ventilateur.id,
        kind: 'CORRECTIVE',
        date: daysAgo(5),
        description: 'Remplacement moteur',
        repairsBreakdown: true,
      });
      await declare(ventilateur.id, {
        date: daysAgo(2),
        description: 'Court-circuit',
      });
      const refused = await http()
        .delete(`/api/maintenance/${second.id}`)
        .set(director)
        .expect(409);
      expect(message(refused.body as Msg)).toBe(OTHER_OPEN);
      expect(await prisma.maintenance.count()).toBe(1);
    });

    it('checks what a repair needs', async () => {
      await reference();
      const body = (over: object) => ({
        equipmentId: ventilateur.id,
        kind: 'CORRECTIVE',
        date: daysAgo(5),
        description: 'Réparation',
        repairsBreakdown: true,
        ...over,
      });
      expect(message(await intervene(body({ kind: 'PREVENTIVE' }), 400))).toBe(
        NOT_CORRECTIVE,
      );
      expect(message(await intervene(body({ date: daysAgo(13) }), 400))).toBe(
        BEFORE_BREAKDOWN,
      );
      expect(
        message(await intervene(body({ equipmentId: groupe.id }), 409)),
      ).toBe(NO_OPEN);
      await intervene(body({ conditionAfter: 'EN_PANNE' }), 400);
      await intervene(body({ conditionAfter: 'MOYEN' }), 400);
      expect(
        message(
          await intervene(
            { equipmentId: groupe.id, conditionAfter: 'BON' },
            400,
          ),
        ),
      ).toBe("L'état après intervention suppose la réparation d'une panne");
      // the same day as the breakdown is allowed
      await intervene(body({ date: daysAgo(12) }));
      expect(await prisma.maintenance.count()).toBe(1);
    });

    it('a corrective intervention without the repair flag leaves the equipment broken', async () => {
      await reference();
      await intervene({
        equipmentId: ventilateur.id,
        kind: 'CORRECTIVE',
        description: 'Diagnostic',
      });
      await intervene({
        equipmentId: ventilateur.id,
        kind: 'CORRECTIVE',
        description: 'Diagnostic 2',
        repairsBreakdown: false,
      });
      const after = await get(ventilateur.id);
      expect(after.condition).toBe('EN_PANNE');
      expect(after.openBreakdown).not.toBeNull();
    });

    it('validates the body: dates, cost, ids and kinds', async () => {
      await reference();
      const body = (over: object) => ({
        equipmentId: groupe.id,
        kind: 'PREVENTIVE',
        ...over,
      });
      expect(message(await intervene(body({ date: daysAgo(-1) }), 400))).toBe(
        FUTURE,
      );
      await intervene(body({ date: 'hier' }), 400);
      await intervene(body({ nextDate: daysAgo(1) }), 400);
      await intervene(body({ date: daysAgo(3), nextDate: daysAgo(3) }), 400);
      await intervene(body({ cost: -1 }), 400);
      await intervene(body({ cost: 10.123 }), 400);
      await intervene(body({ kind: 'AUTRE' }), 400);
      await intervene(body({ kind: undefined }), 400);
      await intervene(body({ description: '  ' }), 400);
      await intervene(body({ equipmentId: undefined }), 400);
      await intervene(body({ unknown: 1 }), 400);
      expect(message(await intervene(body({ equipmentId: 'nope' }), 400))).toBe(
        EQUIPMENT_INVALID,
      );
      expect(message(await intervene(body({ supplierId: 'nope' }), 400))).toBe(
        SUPPLIER_INVALID,
      );
      expect(await prisma.maintenance.count()).toBe(0);
      // cost null and 0 are a free intervention
      await intervene(body({ cost: null }));
      await intervene(body({ cost: 0, description: 'Gratuit' }));
      expect(await entries()).toHaveLength(0);
    });

    it('takes the supplier of the organisation and shows its name', async () => {
      await reference();
      const supplier = await world.post<Id>(director, '/suppliers', {
        name: 'Atelier Kossi',
      });
      const done = await intervene({
        equipmentId: groupe.id,
        supplierId: supplier.id,
        cost: 1000,
      });
      expect(done).toMatchObject({
        supplierId: supplier.id,
        supplierName: 'Atelier Kossi',
      });
      const otherOrg = await prisma.organization.create({
        data: { name: 'Autre' },
      });
      const foreign = await prisma.supplier.create({
        data: { organizationId: otherOrg.id, name: 'Étranger' },
      });
      expect(
        message(
          await intervene(
            { equipmentId: groupe.id, supplierId: foreign.id },
            400,
          ),
        ),
      ).toBe(SUPPLIER_INVALID);
      await patchIntervention(done.id, { supplierId: foreign.id }, 400);
      const cleared = await patchIntervention(done.id, { supplierId: null });
      expect(cleared).toMatchObject({ supplierId: null, supplierName: null });
    });

    it('is master data: AGENT and RESP_AVICOLE read but never write', async () => {
      await reference();
      const done = await intervene({ equipmentId: groupe.id, cost: 1000 });
      for (const h of [agent, poultry, accountant]) {
        await intervene({ equipmentId: groupe.id }, 403, h);
        await patchIntervention(done.id, { description: 'x' }, 403, h);
        await removeIntervention(done.id, 403, h);
      }
      expect(await prisma.maintenance.count()).toBe(1);
    });

    it('refuses an intervention on an equipment of another farm, and on a retired one', async () => {
      const other = await createFarm(world.orgId, 'Ferme B');
      const foreign = await prisma.equipment.create({
        data: { farmId: other.id, name: 'Étranger', type: 'POMPE' },
      });
      expect(message(await intervene({ equipmentId: foreign.id }, 400))).toBe(
        EQUIPMENT_INVALID,
      );
      await reference();
      await http()
        .post(`/api/equipment/${pompe.id}/retire`)
        .set(director)
        .send({ date: daysAgo(1) })
        .expect(200);
      expect(message(await intervene({ equipmentId: pompe.id }, 409))).toBe(
        RETIRED,
      );
    });

    it('keeps the cached next maintenance exact after create, edit and delete', async () => {
      const made = await make({
        name: 'Groupe',
        type: 'GROUPE_ELECTROGENE',
        maintenanceIntervalDays: 90,
        firstMaintenanceDate: daysAgo(30),
      });
      await expectCacheExact(made.id);
      const first = await intervene({
        equipmentId: made.id,
        date: daysAgo(20),
        nextDate: daysAgo(-70),
      });
      expect((await get(made.id)).nextMaintenance).toBe(daysAgo(-70));
      await expectCacheExact(made.id);
      const second = await intervene({
        equipmentId: made.id,
        date: daysAgo(5),
      });
      expect((await get(made.id)).nextMaintenance).toBe(
        formatDay(
          new Date((parseDay(daysAgo(5)) as Date).getTime() + 90 * 86_400_000),
        ),
      );
      await expectCacheExact(made.id);
      await patchIntervention(second.id, { date: daysAgo(10) });
      await expectCacheExact(made.id);
      await patchIntervention(second.id, { nextDate: daysAgo(-5) });
      expect((await get(made.id)).nextMaintenance).toBe(daysAgo(-5));
      await patchIntervention(second.id, { nextDate: null });
      await expectCacheExact(made.id);
      await removeIntervention(second.id);
      expect((await get(made.id)).nextMaintenance).toBe(daysAgo(-70));
      await expectCacheExact(made.id);
      await removeIntervention(first.id);
      expect((await get(made.id)).nextMaintenance).toBe(daysAgo(30));
      await expectCacheExact(made.id);
    });

    it('edits an intervention, a cost cleared with null being stored as 0', async () => {
      await reference();
      const done = await intervene({
        equipmentId: groupe.id,
        date: daysAgo(5),
        description: 'Vidange',
        cost: 45000,
        performedBy: 'Kossi',
        nextDate: daysAgo(-80),
      });
      const edited = await patchIntervention(done.id, {
        description: 'Vidange + filtres',
        cost: 50000,
        performedBy: null,
        date: daysAgo(6),
        kind: 'CORRECTIVE',
      });
      expect(edited).toMatchObject({
        description: 'Vidange + filtres',
        cost: 50000,
        performedBy: null,
        date: daysAgo(6),
        kind: 'CORRECTIVE',
      });
      const [row] = await entries();
      expect(row).toMatchObject({
        label: `Maintenance ${GROUPE} — Vidange + filtres`,
        amount: 50000,
        date: daysAgo(6),
      });
      const free = await patchIntervention(done.id, { cost: null });
      expect(free.cost).toBe(0);
      expect(await entries()).toHaveLength(0);
      await patchIntervention(done.id, { equipmentId: pompe.id }, 400);
      await patchIntervention(done.id, { date: daysAgo(-1) }, 400);
      await patchIntervention(done.id, { nextDate: daysAgo(6) }, 400);
      await patchIntervention(done.id, { kind: null }, 400);
      await patchIntervention(done.id, { description: null }, 400);
      await patchIntervention(done.id, { cost: -5 }, 400);
      await patchIntervention('nope', { cost: 1 }, 404);
      await patchIntervention(done.id, { repairsBreakdown: true }, 400);
    });

    it('keeps a repairing intervention corrective and dated after its breakdown', async () => {
      await reference();
      const done = await intervene({
        equipmentId: ventilateur.id,
        kind: 'CORRECTIVE',
        date: daysAgo(5),
        repairsBreakdown: true,
      });
      expect(
        message(await patchIntervention(done.id, { kind: 'PREVENTIVE' }, 409)),
      ).toBe('Cette intervention répare une panne : elle reste corrective');
      expect(
        message(await patchIntervention(done.id, { date: daysAgo(13) }, 400)),
      ).toBe(BEFORE_BREAKDOWN);
      await patchIntervention(done.id, { date: daysAgo(8) });
      expect((await get(ventilateur.id)).breakdowns[0].resolvedDate).toBe(
        daysAgo(8),
      );
    });

    it('lists the interventions with their filters, the cost only with finance:read', async () => {
      await reference();
      const a = await intervene({
        equipmentId: groupe.id,
        date: daysAgo(9),
        description: 'Vidange',
        cost: 45000,
        performedBy: 'Kossi',
      });
      const b = await intervene({
        equipmentId: couveuse.id,
        kind: 'CORRECTIVE',
        date: daysAgo(4),
        description: 'Joint de porte',
      });
      const all = await interventions();
      expect(all.total).toBe(2);
      expect(all.items.map((i) => i.id)).toEqual([b.id, a.id]);
      expect(all.items[1]).toMatchObject({
        equipmentName: GROUPE,
        cost: 45000,
        performedBy: 'Kossi',
      });
      expect(
        (await interventions(`?equipmentId=${couveuse.id}`)).items.map(
          (i) => i.id,
        ),
      ).toEqual([b.id]);
      expect(
        (await interventions('?kind=PREVENTIVE')).items.map((i) => i.id),
      ).toEqual([a.id]);
      expect(
        (await interventions(`?from=${daysAgo(5)}&to=${daysAgo(3)}`)).items.map(
          (i) => i.id,
        ),
      ).toEqual([b.id]);
      expect(
        (await interventions('?search=vidange')).items.map((i) => i.id),
      ).toEqual([a.id]);
      expect(
        (await interventions('?search=couveuse')).items.map((i) => i.id),
      ).toEqual([b.id]);
      expect(
        (await interventions('?sort=date:asc')).items.map((i) => i.id),
      ).toEqual([a.id, b.id]);
      await http().get('/api/maintenance?kind=X').set(director).expect(400);
      await http()
        .get('/api/maintenance?sort=cost:asc')
        .set(director)
        .expect(400);
      const seen = await interventions('', agent);
      expect(seen.items.every((i) => i.cost === null)).toBe(true);
      await http().get('/api/maintenance').set(accountant).expect(403);
    });

    it('exports the interventions, with the cost column only for finance readers', async () => {
      await reference();
      await intervene({
        equipmentId: groupe.id,
        date: daysAgo(9),
        description: 'Vidange',
        cost: 45000,
        performedBy: 'Kossi',
        nextDate: daysAgo(-80),
      });
      const text = async (h: Headers) =>
        (
          await http().get('/api/maintenance?format=csv').set(h).expect(200)
        ).text
          .replace('﻿', '')
          .split('\r\n');
      const withCost = await text(director);
      expect(withCost[0]).toBe(
        'Date;Équipement;Type;Description;Intervenant;Prochaine date;Coût',
      );
      expect(withCost[1]).toBe(
        `${daysAgo(9)};${GROUPE};Préventive;Vidange;Kossi;${daysAgo(-80)};45000`,
      );
      const without = await text(agent);
      expect(without[0]).toBe(
        'Date;Équipement;Type;Description;Intervenant;Prochaine date',
      );
      expect(without[1]).toBe(
        `${daysAgo(9)};${GROUPE};Préventive;Vidange;Kossi;${daysAgo(-80)}`,
      );
    });
  });

  describe('finance', () => {
    it('is derived: a finance entry of maintenance cannot be edited or deleted there', async () => {
      await reference();
      const done = await intervene({
        equipmentId: groupe.id,
        description: 'Vidange',
        cost: 45000,
      });
      const id = `maintenance:${done.id}`;
      const patched = await http()
        .patch(`/api/finance/entries/${id}`)
        .set(accountant)
        .send({ label: 'x' })
        .expect(409);
      expect(message(patched.body as Msg)).toBe(DERIVED);
      await http()
        .delete(`/api/finance/entries/${id}`)
        .set(accountant)
        .expect(409);
      const listed = await entries('origin=MAINTENANCE', accountant);
      expect(listed.map((e) => e.id)).toEqual([id]);
    });

    it('never changes a lot profitability', async () => {
      await reference();
      const lot = await world.lot(poultry, { buildingId: poulaillerB });
      const lots = async () =>
        (await http().get('/api/finance/lots').set(director).expect(200))
          .body as unknown;
      const detail = async () =>
        (
          await http()
            .get(`/api/finance/lots/${lot.id}`)
            .set(director)
            .expect(200)
        ).body as unknown;
      const before = [await lots(), await detail()];
      await intervene({
        equipmentId: ventilateur.id,
        kind: 'CORRECTIVE',
        date: daysAgo(5),
        description: 'Remplacement moteur',
        cost: 30000,
        repairsBreakdown: true,
      });
      expect([await lots(), await detail()]).toEqual(before);
      expect(await expenses()).toBeGreaterThanOrEqual(30000);
    });
  });

  describe('retiring and deleting', () => {
    it('retires an equipment: out of the default list and of the alerts, in the retired list, read-only', async () => {
      await reference();
      const retired = await http()
        .post(`/api/equipment/${pompe.id}/retire`)
        .set(director)
        .send({ date: daysAgo(1) })
        .expect(200);
      expect(retired.body).toMatchObject({
        id: pompe.id,
        retiredAt: daysAgo(1),
      });
      const live = await list();
      expect(live.items.map((i) => i.name)).not.toContain(POMPE);
      expect(live.statusCounts).toEqual({
        BON: 1,
        A_SURVEILLER: 1,
        EN_PANNE: 1,
      });
      const old = await list('?retired=true');
      expect(old.items.map((i) => [i.name, i.retiredAt])).toEqual([
        [POMPE, daysAgo(1)],
      ]);
      expect((await alerts()).map((a) => a.key)).not.toContain(
        `maintenance:${pompe.id}:${daysAgo(-1)}`,
      );
      expect(message(await patch(pompe.id, { note: 'x' }, 409))).toBe(RETIRED);
      expect(message(await declare(pompe.id, undefined, 409))).toBe(RETIRED);
      expect(
        message(
          await refuse(
            'post',
            `/equipment/${pompe.id}/retire`,
            { date: daysAgo(0) },
            409,
          ),
        ),
      ).toBe(RETIRED);
      expect((await get(pompe.id)).retiredAt).toBe(daysAgo(1));
    });

    it('refuses a future retirement date, and reinstates', async () => {
      await reference();
      await refuse('post', `/equipment/${pompe.id}/retire`, {}, 400);
      await refuse(
        'post',
        `/equipment/${pompe.id}/retire`,
        { date: daysAgo(-1) },
        400,
      );
      expect(
        message(
          await refuse('post', `/equipment/${pompe.id}/reinstate`, {}, 409),
        ),
      ).toBe("Cet équipement n'est pas réformé");
      await http()
        .post(`/api/equipment/${pompe.id}/retire`)
        .set(director)
        .send({ date: daysAgo(1) })
        .expect(200);
      const back = await http()
        .post(`/api/equipment/${pompe.id}/reinstate`)
        .set(director)
        .expect(200);
      expect(back.body).toMatchObject({ id: pompe.id, retiredAt: null });
      expect((await list()).total).toBe(4);
      expect((await list('?retired=true')).total).toBe(0);
      await patch(pompe.id, { note: 'de retour' });
    });

    it('deletes an equipment without history, and refuses one with an intervention, a breakdown or a task (409)', async () => {
      await reference();
      const lonely = await make({ name: 'Solitaire', type: 'AUTRE' });
      await http()
        .delete(`/api/equipment/${lonely.id}`)
        .set(director)
        .expect(200);
      expect(await prisma.equipment.count({ where: { id: lonely.id } })).toBe(
        0,
      );
      const rows = (await audit()).filter((r) => r.recordId === lonely.id);
      expect(rows.map((r) => r.action)).toEqual(['CREATE', 'DELETE']);
      await http()
        .delete(`/api/equipment/${lonely.id}`)
        .set(director)
        .expect(404);

      await intervene({ equipmentId: groupe.id });
      for (const withHistory of [groupe, ventilateur]) {
        const refused = await http()
          .delete(`/api/equipment/${withHistory.id}`)
          .set(director)
          .expect(409);
        expect(message(refused.body as Msg)).toBe(HISTORY);
      }
      const task = await world.post<Id>(poultry, '/tasks', {
        title: 'Graisser la balance',
        dueDate: daysAgo(-3),
        equipmentId: pompe.id,
      });
      expect(task.id).toBeDefined();
      expect(
        message(
          (
            await http()
              .delete(`/api/equipment/${pompe.id}`)
              .set(director)
              .expect(409)
          ).body as Msg,
        ),
      ).toBe(HISTORY);
      expect(await prisma.equipment.count()).toBe(4);
    });
  });

  describe('isolation between farms', () => {
    it("answers 404 for another farm's equipment on every route and 400 when its id is in a body", async () => {
      const other = await createFarm(world.orgId, 'Ferme B');
      const foreign = await prisma.equipment.create({
        data: { farmId: other.id, name: 'Étranger', type: 'POMPE' },
      });
      const otherUser = await createUser({
        organizationId: world.orgId,
        role: 'DIRECTEUR_FERME',
        farmIds: [other.id],
      });
      const otherHeaders = {
        Authorization: `Bearer ${await tokenFor(otherUser.id)}`,
        'X-Farm-Id': other.id,
      };
      await http()
        .get(`/api/equipment/${foreign.id}`)
        .set(director)
        .expect(404);
      await patch(foreign.id, { note: 'x' }, 404);
      await refuse('delete', `/equipment/${foreign.id}`, {}, 404);
      await declare(foreign.id, undefined, 404);
      await refuse(
        'post',
        `/equipment/${foreign.id}/retire`,
        { date: daysAgo(1) },
        404,
      );
      await refuse('post', `/equipment/${foreign.id}/reinstate`, {}, 404);
      expect((await list()).total).toBe(0);
      expect((await interventions(`?equipmentId=${foreign.id}`)).total).toBe(0);
      expect(message(await intervene({ equipmentId: foreign.id }, 400))).toBe(
        EQUIPMENT_INVALID,
      );
      await http()
        .post('/api/tasks')
        .set(director)
        .send({ title: 'Vol', dueDate: daysAgo(-1), equipmentId: foreign.id })
        .expect(400)
        .then((res) =>
          expect(message(res.body as Msg)).toBe(EQUIPMENT_INVALID),
        );
      // the owner farm still sees it, and another farm's maintenance stays invisible here
      const done = await http()
        .post('/api/maintenance')
        .set(otherHeaders)
        .send({
          equipmentId: foreign.id,
          kind: 'PREVENTIVE',
          date: daysAgo(1),
          description: 'x',
        })
        .expect(201);
      const foreignId = (done.body as Id).id;
      await patchIntervention(foreignId, { description: 'y' }, 404);
      await removeIntervention(foreignId, 404);
      expect((await interventions()).total).toBe(0);
    });
  });

  describe('tasks on equipment', () => {
    it('targets an equipment in service from a task, counts the open tasks, and refuses a retired one', async () => {
      await reference();
      const task = await world.post<{
        id: string;
        target: { kind: string; id: string; label: string };
      }>(poultry, '/tasks', {
        title: 'Contrôler la pompe',
        dueDate: daysAgo(-2),
        equipmentId: pompe.id,
      });
      expect(task.target).toEqual({
        kind: 'EQUIPEMENT',
        id: pompe.id,
        label: POMPE,
      });
      const tasks = (
        await http()
          .get(`/api/tasks?equipmentId=${pompe.id}`)
          .set(director)
          .expect(200)
      ).body as Page<{ id: string }>;
      expect(tasks.items.map((t) => t.id)).toEqual([task.id]);
      const detail = await get(pompe.id);
      expect(detail.openTasks).toBe(1);
      expect(detail.hasHistory).toBe(true);
      await http()
        .post(`/api/tasks/${task.id}/complete`)
        .set(poultry)
        .send({})
        .expect(200);
      expect((await get(pompe.id)).openTasks).toBe(0);
      expect((await get(pompe.id)).hasHistory).toBe(true);
      await http()
        .post(`/api/equipment/${couveuse.id}/retire`)
        .set(director)
        .send({ date: daysAgo(1) })
        .expect(200);
      await http()
        .post('/api/tasks')
        .set(poultry)
        .send({ title: 'Nope', dueDate: daysAgo(-2), equipmentId: couveuse.id })
        .expect(400)
        .then((res) =>
          expect(message(res.body as Msg)).toBe(EQUIPMENT_INVALID),
        );
      const open = await world.post<Id>(poultry, '/tasks', {
        title: 'Autre tâche',
        dueDate: daysAgo(-2),
      });
      const moved = await http()
        .patch(`/api/tasks/${open.id}`)
        .set(poultry)
        .send({ equipmentId: ventilateur.id })
        .expect(200);
      expect((moved.body as { target: { label: string } }).target.label).toBe(
        VENTILATEUR,
      );
      await http()
        .patch(`/api/tasks/${open.id}`)
        .set(poultry)
        .send({ equipmentId: 'nope' })
        .expect(400);
    });
  });

  describe('recurring tasks on retired equipment', () => {
    it('leaves a retired equipment out of the next occurrence instead of failing the completion', async () => {
      await reference();
      const task = await world.post<Id>(poultry, '/tasks', {
        title: 'Graisser la pompe',
        dueDate: daysAgo(1),
        equipmentId: pompe.id,
        recurrence: 'HEBDOMADAIRE',
      });
      // Retirement refuses open tasks, so the state is forced in the table.
      await prisma.equipment.update({
        where: { id: pompe.id },
        data: { retiredAt: parseDay(daysAgo(1)) as Date },
      });
      await http()
        .post(`/api/tasks/${task.id}/complete`)
        .set(poultry)
        .send({})
        .expect(200);
      const next = await prisma.task.findFirstOrThrow({
        where: { previousTaskId: task.id },
      });
      expect(next.equipmentId).toBeNull();
    });
  });

  describe('alerts', () => {
    const ctxOf = (): RequestContext => ({
      user: {
        id: 'u',
        name: 'u',
        role: 'DIRECTEUR_FERME',
        organizationId: world.orgId,
      },
      farmId: world.farmId,
      allFarms: false,
      farmIds: [world.farmId],
    });

    it('raises the breakdown (URGENT) then the dues by date, none for retired equipment, and follows the interventions', async () => {
      await reference();
      const items = await alerts();
      expect(items).toEqual([
        {
          key: `breakdown:${ventilateur.id}`,
          title: 'Équipement en panne',
          detail: VENTILATEUR,
          level: 'URGENT',
        },
        {
          key: `maintenance:${couveuse.id}:${daysAgo(20)}`,
          title: 'Maintenance due',
          detail: COUVEUSE,
          level: 'A_VOIR',
        },
        {
          key: `maintenance:${groupe.id}:${daysAgo(15)}`,
          title: 'Maintenance due',
          detail: GROUPE,
          level: 'A_VOIR',
        },
      ]);
      await http()
        .post(`/api/equipment/${couveuse.id}/retire`)
        .set(director)
        .send({ date: daysAgo(1) })
        .expect(200);
      expect((await alerts()).map((a) => a.detail)).toEqual([
        VENTILATEUR,
        GROUPE,
      ]);
      await intervene({
        equipmentId: ventilateur.id,
        kind: 'CORRECTIVE',
        repairsBreakdown: true,
        nextDate: daysAgo(-60),
      });
      expect((await alerts()).map((a) => a.detail)).toEqual([GROUPE]);
    });

    it('follows the maintenanceWarningDays setting', async () => {
      await reference();
      const admin = await world.actor('SUPER_ADMIN');
      await http()
        .put('/api/settings/maintenanceWarningDays')
        .set(admin)
        .send({ value: 1 })
        .expect(200);
      expect((await alerts()).map((a) => a.detail)).toEqual([
        VENTILATEUR,
        COUVEUSE,
        GROUPE,
        POMPE,
      ]);
      const settings = (
        await http().get('/api/settings').set(admin).expect(200)
      ).body as Record<string, unknown>;
      expect(settings.maintenanceWarningDays).toBe(1);
      expect((await get(pompe.id, director)).maintenanceDue).toBe(true);
      for (const bad of [-1, 1.5, '2', null]) {
        await http()
          .put('/api/settings/maintenanceWarningDays')
          .set(admin)
          .send({ value: bad })
          .expect(400);
      }
      await http()
        .put('/api/settings/maintenanceWarningDays')
        .set(admin)
        .send({ value: 0 })
        .expect(200);
    });

    it('shows the equipment alerts to the readers of equipements only', async () => {
      await reference();
      expect((await alerts(agent)).length).toBe(3);
      expect((await alerts(poultry)).length).toBe(3);
      expect(await alerts(await world.actor('COMMERCIAL'))).toEqual([]);
      expect(await alerts(accountant)).toEqual([]);
    });

    it('runs the rule in one query whatever the number of equipment', async () => {
      await reference();
      const service = app.get(EquipmentAlertsService);
      const day = parseDay(daysAgo(0)) as Date;
      const run = () =>
        countQueries(app, async () => {
          await service.attention(ctxOf(), day, 0);
        });
      expect(await run()).toBe(1);
      await prisma.equipment.createMany({
        data: Array.from({ length: 40 }, (_, i) => ({
          farmId: world.farmId,
          name: `Bulk ${i}`,
          type: 'POMPE' as const,
          condition: i % 2 ? ('EN_PANNE' as const) : ('BON' as const),
          nextMaintenanceDate: parseDay(daysAgo(i)) as Date,
        })),
      });
      expect(await run()).toBe(1);
      expect(await service.attention(ctxOf(), day, 0)).toHaveLength(3 + 40);
    });
  });

  describe('concurrency and money visibility', () => {
    it('two breakdowns declared at once give one 201 and one 409', async () => {
      const made = await make({ name: 'Pompe', type: 'POMPE' });
      const statuses = await Promise.all(
        [1, 2, 3].map((i) =>
          http()
            .post(`/api/equipment/${made.id}/breakdowns`)
            .set(agent)
            .send({ date: daysAgo(1), description: `Panne ${i}` })
            .then((res) => res.status),
        ),
      );
      expect(statuses.filter((s) => s === 201)).toHaveLength(1);
      expect(statuses.filter((s) => s === 409)).toHaveLength(2);
      expect(await prisma.breakdown.count()).toBe(1);
    });

    it('a deletion racing an intervention never leaves an intervention on a deleted equipment, nor a 500', async () => {
      for (let i = 0; i < 5; i += 1) {
        const made = await make({ name: `Pompe ${i}`, type: 'POMPE' });
        const [deleted, created] = await Promise.all([
          http()
            .delete(`/api/equipment/${made.id}`)
            .set(director)
            .then((res) => res.status),
          http()
            .post('/api/maintenance')
            .set(director)
            .send({
              equipmentId: made.id,
              kind: 'PREVENTIVE',
              date: daysAgo(1),
              description: 'Contrôle',
            })
            .then((res) => res.status),
        ]);
        const outcome = `${deleted}/${created}`;
        expect(['200/400', '409/201']).toContain(outcome);
        const left = await prisma.maintenance.count({
          where: { equipmentId: made.id },
        });
        expect(left).toBe(created === 201 ? 1 : 0);
      }
    });

    it('ignores the cost of a writer without finance:read and never shows it to them', async () => {
      await reference();
      const service = app.get(MaintenanceService);
      const ctx: RequestContext = {
        user: {
          id: (await prisma.user.findFirstOrThrow()).id,
          name: 'u',
          role: 'RESP_AVICOLE',
          organizationId: world.orgId,
        },
        farmId: world.farmId,
        allFarms: false,
        farmIds: [world.farmId],
      };
      const created = await service.create(ctx, {
        equipmentId: groupe.id,
        kind: 'PREVENTIVE',
        date: daysAgo(1),
        description: 'Contrôle',
        cost: 5000,
      });
      expect(created.cost).toBeNull();
      expect(
        (
          await prisma.maintenance.findUniqueOrThrow({
            where: { id: created.id },
          })
        ).cost.toNumber(),
      ).toBe(0);
      expect(await entries()).toHaveLength(0);
    });
  });

  describe('polish round', () => {
    const retire = (id: string, date: string, status = 200) =>
      http()
        .post(`/api/equipment/${id}/retire`)
        .set(director)
        .send({ date })
        .expect(status)
        .then((res) => res.body as Msg);

    it('carries the equipment id on the finance rows of maintenance, and none on the others', async () => {
      await reference();
      const done = await intervene({ equipmentId: groupe.id, cost: 4000 });
      await http()
        .post('/api/finance/entries')
        .set(accountant)
        .send({
          date: daysAgo(2),
          kind: 'DEPENSE',
          label: 'Électricité',
          activity: 'GENERAL',
          category: 'ENERGIE',
          amount: 100,
        })
        .expect(201);
      const rows = (
        await http().get('/api/finance/entries').set(accountant).expect(200)
      ).body as Page<FinanceRow & { equipmentId: string | null }>;
      expect(rows.items).toHaveLength(2);
      for (const r of rows.items) {
        expect(r.equipmentId).toBe(
          r.id === `maintenance:${done.id}` ? groupe.id : undefined,
        );
      }
    });

    it('allows retiring a broken equipment, refuses it with open tasks, and checks the date', async () => {
      await reference();
      await retire(ventilateur.id, daysAgo(1));
      expect((await get(ventilateur.id)).retiredAt).toBe(daysAgo(1));

      const task = await world.post<Id>(poultry, '/tasks', {
        title: 'Graisser',
        dueDate: daysAgo(-2),
        equipmentId: pompe.id,
      });
      expect(message(await retire(pompe.id, daysAgo(1), 409))).toBe(
        'Des tâches ouvertes portent sur cet équipement',
      );
      await http()
        .post(`/api/tasks/${task.id}/complete`)
        .set(poultry)
        .send({})
        .expect(200);
      await retire(pompe.id, daysAgo(1));

      const dated = await make({
        name: 'Balance',
        type: 'BALANCE',
        purchaseDate: daysAgo(30),
      });
      expect(message(await retire(dated.id, daysAgo(31), 400))).toBe(
        "La date de réforme précède l'achat de l'équipement",
      );
      await intervene({ equipmentId: dated.id, date: daysAgo(5) });
      expect(message(await retire(dated.id, daysAgo(6), 400))).toBe(
        'La date de réforme précède la dernière intervention ou panne',
      );
      expect(message(await retire(dated.id, daysAgo(-1), 400))).toBe(FUTURE);
      await retire(dated.id, daysAgo(5));
    });

    it('refuses a deletion of a retired equipment like any other write (409)', async () => {
      const made = await make({ name: 'Balance', type: 'BALANCE' });
      await retire(made.id, daysAgo(1));
      expect(
        message(await refuse('delete', `/equipment/${made.id}`, {}, 409)),
      ).toBe(RETIRED);
    });

    it('refuses an intervention dated before the purchase of the equipment', async () => {
      const made = await make({
        name: 'Balance',
        type: 'BALANCE',
        purchaseDate: daysAgo(30),
      });
      expect(
        message(
          await intervene({ equipmentId: made.id, date: daysAgo(31) }, 400),
        ),
      ).toBe("La date précède l'achat de l'équipement");
      const ok = await intervene({ equipmentId: made.id, date: daysAgo(30) });
      await patchIntervention(ok.id, { date: daysAgo(31) }, 400);
    });

    it('refuses to delete a site that carries equipment', async () => {
      await reference();
      const refused = await http()
        .delete(`/api/sites/${siteNord}`)
        .set(director)
        .expect(409);
      expect(message(refused.body as Msg)).toBe(
        'Ce site porte des équipements',
      );
    });

    it('a retirement racing a task creation never leaves an open task on a retired equipment', async () => {
      for (let i = 0; i < 5; i += 1) {
        const made = await make({ name: `Pompe ${i}`, type: 'POMPE' });
        const [retired, created] = await Promise.all([
          http()
            .post(`/api/equipment/${made.id}/retire`)
            .set(director)
            .send({ date: daysAgo(1) })
            .then((res) => res.status),
          http()
            .post('/api/tasks')
            .set(poultry)
            .send({
              title: 'Course',
              dueDate: daysAgo(-2),
              equipmentId: made.id,
            })
            .then((res) => res.status),
        ]);
        expect(['200/400', '409/201']).toContain(`${retired}/${created}`);
      }
    });
  });

  describe('audit', () => {
    it('writes exactly one row per write, in module equipements', async () => {
      const made = await make({ name: 'Pompe', type: 'POMPE' });
      await patch(made.id, { note: 'a' });
      await declare(made.id, { date: daysAgo(3), description: 'Fuite' });
      const done = await intervene({
        equipmentId: made.id,
        kind: 'CORRECTIVE',
        cost: 5000,
        repairsBreakdown: true,
      });
      await patchIntervention(done.id, { description: 'Joint' });
      await removeIntervention(done.id);
      await http()
        .post(`/api/equipment/${made.id}/retire`)
        .set(director)
        .send({ date: daysAgo(1) })
        .expect(200);
      await http()
        .post(`/api/equipment/${made.id}/reinstate`)
        .set(director)
        .expect(200);
      const rows = await audit();
      expect(rows.map((r) => r.action)).toEqual([
        'CREATE',
        'UPDATE',
        'CREATE',
        'CREATE',
        'UPDATE',
        'DELETE',
        'UPDATE',
        'UPDATE',
      ]);
      expect(rows.every((r) => r.farmId === world.farmId)).toBe(true);
      expect(rows[3].recordId).toBe(done.id);
      expect(rows[5].recordId).toBe(done.id);
    });
  });
});
