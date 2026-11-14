import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { PrismaService } from '../src/prisma/prisma.service';
import type { Role } from '../src/generated/prisma/enums';
import {
  createFarm,
  createOrganization,
  createTestApp,
  createUser,
  resetDb,
  tokenFor,
} from './setup';

interface BuildingItem {
  id: string;
  name: string;
  type: string;
  siteId: string;
  siteName: string;
  capacity: number;
  occupation: number;
  occupationRate: number;
  status: string;
  zones: number;
}
interface BuildingPage {
  items: BuildingItem[];
  total: number;
  page: number;
  pageSize: number;
  statusCounts: Record<string, number>;
}

describe('Administration resources (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let orgId: string;
  let farmA: string;
  let farmB: string;
  let siteA: string;
  let siteB: string;

  const http = () => request(app.getHttpServer() as App);

  async function actor(role: Role, farmIds: string[] = [farmA], farm = farmA) {
    const user = await createUser({ organizationId: orgId, role, farmIds });
    const token = await tokenFor(user.id);
    return {
      user,
      headers: { Authorization: `Bearer ${token}`, 'X-Farm-Id': farm },
    };
  }

  const building = (over: Record<string, unknown> = {}) => ({
    name: 'Poulailler 1',
    type: 'AVICOLE',
    siteId: siteA,
    capacity: 1000,
    ...over,
  });

  beforeAll(async () => {
    app = await createTestApp();
    prisma = new PrismaService();
  });

  beforeEach(async () => {
    await resetDb();
    orgId = (await createOrganization()).id;
    farmA = (await createFarm(orgId, 'Ferme A')).id;
    farmB = (await createFarm(orgId, 'Ferme B')).id;
    siteA = (
      await prisma.site.create({ data: { farmId: farmA, name: 'Site A' } })
    ).id;
    siteB = (
      await prisma.site.create({ data: { farmId: farmB, name: 'Site B' } })
    ).id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  describe('buildings', () => {
    it('supports CRUD as DIRECTEUR_FERME and audits each write', async () => {
      const { headers } = await actor('DIRECTEUR_FERME');
      const created = await http()
        .post('/api/buildings')
        .set(headers)
        .send(building())
        .expect(201);
      const b = created.body as BuildingItem;
      expect(b).toMatchObject({
        name: 'Poulailler 1',
        type: 'AVICOLE',
        siteName: 'Site A',
        capacity: 1000,
        occupation: 0,
        occupationRate: 0,
        status: 'ACTIF',
        zones: 0,
      });

      await http().get(`/api/buildings/${b.id}`).set(headers).expect(200);
      const patched = await http()
        .patch(`/api/buildings/${b.id}`)
        .set(headers)
        .send({ capacity: 1200, status: 'MAINTENANCE' })
        .expect(200);
      expect(patched.body).toMatchObject({
        capacity: 1200,
        status: 'MAINTENANCE',
      });
      await http().delete(`/api/buildings/${b.id}`).set(headers).expect(200);
      await http().get(`/api/buildings/${b.id}`).set(headers).expect(404);

      const logs = await prisma.auditLog.findMany({
        where: { module: 'batiments' },
        orderBy: { createdAt: 'asc' },
      });
      expect(logs.map((l) => l.action)).toEqual(['CREATE', 'UPDATE', 'DELETE']);
      expect(logs.every((l) => l.recordId === b.id)).toBe(true);
      expect(logs[0].farmId).toBe(farmA);
    });

    it('refuses lowering the capacity below the current occupation', async () => {
      const { headers } = await actor('DIRECTEUR_FERME');
      const b = (
        await http().post('/api/buildings').set(headers).send(building())
      ).body as BuildingItem;
      await http()
        .post('/api/batches')
        .set(headers)
        .send({
          species: 'AVICOLE',
          type: 'CHAIR',
          buildingId: b.id,
          entryDate: '2026-01-01',
          initialCount: 800,
        })
        .expect(201);
      const res = await http()
        .patch(`/api/buildings/${b.id}`)
        .set(headers)
        .send({ capacity: 799 })
        .expect(400);
      expect((res.body as { message: string }).message).toBe(
        "La capacité ne peut pas être inférieure à l'occupation actuelle (800)",
      );
      await http()
        .patch(`/api/buildings/${b.id}`)
        .set(headers)
        .send({ capacity: 800 })
        .expect(200);
    });

    it('lists with siteName, occupation 0, rate 0 and statusCounts', async () => {
      const { headers } = await actor('DIRECTEUR_FERME');
      await http().post('/api/buildings').set(headers).send(building());
      await http()
        .post('/api/buildings')
        .set(headers)
        .send(
          building({
            name: 'Porcherie',
            type: 'PORCIN',
            status: 'VIDE_SANITAIRE',
          }),
        );
      const res = await http().get('/api/buildings').set(headers).expect(200);
      const page = res.body as BuildingPage;
      expect(page.total).toBe(2);
      expect(page.items[0]).toMatchObject({
        siteName: 'Site A',
        occupation: 0,
        occupationRate: 0,
        zones: 0,
      });
      expect(page.statusCounts).toEqual({
        ACTIF: 1,
        VIDE_SANITAIRE: 1,
        MAINTENANCE: 0,
      });
    });

    it('searches, filters by status, sorts and paginates', async () => {
      const { headers } = await actor('DIRECTEUR_FERME');
      for (const [name, capacity, status] of [
        ['Poulailler A', 500, 'ACTIF'],
        ['Poulailler B', 900, 'MAINTENANCE'],
        ['Porcherie', 200, 'ACTIF'],
      ] as const) {
        await http()
          .post('/api/buildings')
          .set(headers)
          .send(building({ name, capacity, status }))
          .expect(201);
      }
      const get = async (qs: string) =>
        (await http().get(`/api/buildings?${qs}`).set(headers).expect(200))
          .body as BuildingPage;

      expect((await get('search=POUL')).total).toBe(2);
      const actifs = await get('status=ACTIF');
      expect(actifs.items.map((i) => i.name).sort()).toEqual([
        'Porcherie',
        'Poulailler A',
      ]);
      // statusCounts ignores search/status filters.
      expect(actifs.statusCounts).toMatchObject({ ACTIF: 2, MAINTENANCE: 1 });
      expect(
        (await get('sort=capacity:desc')).items.map((i) => i.capacity),
      ).toEqual([900, 500, 200]);
      const p2 = await get('sort=name:asc&pageSize=2&page=2');
      expect(p2).toMatchObject({ total: 3, page: 2, pageSize: 2 });
      expect(p2.items.map((i) => i.name)).toEqual(['Poulailler B']);
      await http()
        .get('/api/buildings?sort=farmId:asc')
        .set(headers)
        .expect(400);
      await http().get('/api/buildings?status=NOPE').set(headers).expect(400);
    });

    it('exports CSV with the French header and labels', async () => {
      const { headers } = await actor('DIRECTEUR_FERME');
      await http()
        .post('/api/buildings')
        .set(headers)
        .send(building({ status: 'VIDE_SANITAIRE' }));
      const csv = await http()
        .get('/api/buildings?format=csv')
        .set(headers)
        .buffer(true)
        .expect(200);
      expect(csv.headers['content-type']).toContain('text/csv');
      const lines = csv.text.split('\r\n');
      expect(lines[0]).toBe(
        '﻿Nom;Type;Site;Capacité;Occupation;Statut;Taux occ.',
      );
      expect(lines[1]).toBe(
        'Poulailler 1;Avicole;Site A;1000;0;Vide sanitaire;0',
      );
      await http()
        .get('/api/buildings?format=xlsx')
        .set(headers)
        .expect(200)
        .expect('Content-Type', /spreadsheetml/);
    });

    it('rejects a bad capacity, name, type and foreign siteId', async () => {
      const { headers } = await actor('DIRECTEUR_FERME');
      for (const over of [
        { capacity: 0 },
        { capacity: -5 },
        { capacity: 1.5 },
        { name: '   ' },
        { type: 'ELEPHANT' },
      ]) {
        await http()
          .post('/api/buildings')
          .set(headers)
          .send(building(over))
          .expect(400);
      }
      // A site of another farm of the same organisation.
      await http()
        .post('/api/buildings')
        .set(headers)
        .send(building({ siteId: siteB }))
        .expect(400);
      const ok = await http()
        .post('/api/buildings')
        .set(headers)
        .send(building())
        .expect(201);
      await http()
        .patch(`/api/buildings/${(ok.body as BuildingItem).id}`)
        .set(headers)
        .send({ siteId: siteB })
        .expect(400);
      await http()
        .patch(`/api/buildings/${(ok.body as BuildingItem).id}`)
        .set(headers)
        .send({ capacity: 0 })
        .expect(400);
    });

    it('409 on a duplicate name in the farm, 201 for the same name in another farm', async () => {
      const a = await actor('SUPER_ADMIN', [farmA, farmB], farmA);
      const b = await actor('SUPER_ADMIN', [farmA, farmB], farmB);
      await http()
        .post('/api/buildings')
        .set(a.headers)
        .send(building())
        .expect(201);
      const dup = await http()
        .post('/api/buildings')
        .set(a.headers)
        .send(building())
        .expect(409);
      expect((dup.body as { message: string }).message).toBe(
        'Ce nom existe déjà',
      );
      await http()
        .post('/api/buildings')
        .set(b.headers)
        .send(building({ siteId: siteB }))
        .expect(201);
      // Renaming onto an existing name conflicts too.
      const other = await http()
        .post('/api/buildings')
        .set(a.headers)
        .send(building({ name: 'Autre' }));
      await http()
        .patch(`/api/buildings/${(other.body as BuildingItem).id}`)
        .set(a.headers)
        .send({ name: 'Poulailler 1' })
        .expect(409);
    });

    it('isolates farms: a building of farm B is 404 under farm A', async () => {
      const a = await actor('SUPER_ADMIN', [farmA, farmB], farmA);
      const b = await actor('SUPER_ADMIN', [farmA, farmB], farmB);
      const created = await http()
        .post('/api/buildings')
        .set(b.headers)
        .send(building({ name: 'Chez B', siteId: siteB }))
        .expect(201);
      const id = (created.body as BuildingItem).id;
      await http().get(`/api/buildings/${id}`).set(a.headers).expect(404);
      await http()
        .patch(`/api/buildings/${id}`)
        .set(a.headers)
        .send({ name: 'Volé' })
        .expect(404);
      await http().delete(`/api/buildings/${id}`).set(a.headers).expect(404);
      const list = await http()
        .get('/api/buildings')
        .set(a.headers)
        .expect(200);
      expect((list.body as BuildingPage).items).toHaveLength(0);
      expect(
        await prisma.building.count({ where: { id, name: 'Chez B' } }),
      ).toBe(1);
    });

    it('never reaches a building of another organisation', async () => {
      const other = await createOrganization('Autre');
      const otherFarm = await createFarm(other.id, 'Z');
      const otherSite = await prisma.site.create({
        data: { farmId: otherFarm.id, name: 'Z' },
      });
      const foreign = await prisma.building.create({
        data: {
          farmId: otherFarm.id,
          siteId: otherSite.id,
          name: 'Z1',
          type: 'AUTRE',
          capacity: 10,
        },
      });
      const { headers } = await actor('SUPER_ADMIN');
      await http().get(`/api/buildings/${foreign.id}`).set(headers).expect(404);
      await http()
        .get('/api/buildings')
        .set({ ...headers, 'X-Farm-Id': otherFarm.id })
        .expect(403);
    });

    it('lists both farms under X-Farm-Id all for PROPRIETAIRE, but refuses a POST', async () => {
      const admin = await actor('SUPER_ADMIN', [farmA, farmB], farmA);
      const adminB = await actor('SUPER_ADMIN', [farmA, farmB], farmB);
      await http().post('/api/buildings').set(admin.headers).send(building());
      await http()
        .post('/api/buildings')
        .set(adminB.headers)
        .send(building({ name: 'Chez B', siteId: siteB }));
      const owner = await actor('PROPRIETAIRE', [], 'all');
      const res = await http()
        .get('/api/buildings')
        .set(owner.headers)
        .expect(200);
      expect(
        (res.body as BuildingPage).items.map((i) => i.name).sort(),
      ).toEqual(['Chez B', 'Poulailler 1']);
      await http()
        .post('/api/buildings')
        .set(owner.headers)
        .send(building({ name: 'X' }))
        .expect(403);
    });

    it('lets AGENT_ELEVAGE read but not write', async () => {
      const { headers } = await actor('AGENT_ELEVAGE');
      await http().get('/api/buildings').set(headers).expect(200);
      await http()
        .post('/api/buildings')
        .set(headers)
        .send(building())
        .expect(403);
    });
  });

  describe('sites', () => {
    it('supports CRUD, scoped to the farm, with 409 on duplicate and on delete with buildings', async () => {
      const { headers } = await actor('DIRECTEUR_FERME');
      const created = await http()
        .post('/api/sites')
        .set(headers)
        .send({ name: 'Nord' })
        .expect(201);
      const id = (created.body as { id: string }).id;
      await http()
        .post('/api/sites')
        .set(headers)
        .send({ name: 'Nord' })
        .expect(409);
      await http()
        .post('/api/sites')
        .set(headers)
        .send({ name: '' })
        .expect(400);

      const list = await http()
        .get('/api/sites?search=nor')
        .set(headers)
        .expect(200);
      expect(
        (list.body as { items: { id: string }[] }).items.map((s) => s.id),
      ).toEqual([id]);

      await http()
        .patch(`/api/sites/${id}`)
        .set(headers)
        .send({ name: 'Nord 2' })
        .expect(200);
      // Site of another farm: 404.
      await http()
        .patch(`/api/sites/${siteB}`)
        .set(headers)
        .send({ name: 'x' })
        .expect(404);
      await http().delete(`/api/sites/${siteB}`).set(headers).expect(404);

      await http()
        .post('/api/buildings')
        .set(headers)
        .send(building({ siteId: id }))
        .expect(201);
      const del = await http()
        .delete(`/api/sites/${id}`)
        .set(headers)
        .expect(409);
      expect((del.body as { message: string }).message).toBe(
        'Ce site contient des bâtiments',
      );
      await http().delete(`/api/sites/${siteA}`).set(headers).expect(200);
      const logs = await prisma.auditLog.findMany({
        where: { module: 'batiments' },
      });
      expect(logs.filter((l) => l.label === 'Nord')).not.toHaveLength(0);
    });
  });

  describe('zones', () => {
    it('answers 409 to concurrent creations of the same zone name, backed by a unique index', async () => {
      const { headers } = await actor('DIRECTEUR_FERME');
      const b = (
        await http().post('/api/buildings').set(headers).send(building())
      ).body as BuildingItem;
      const attempt = () =>
        http()
          .post('/api/zones')
          .set(headers)
          .send({ buildingId: b.id, name: 'Zone concurrente' });
      const statuses = (await Promise.all([attempt(), attempt()]))
        .map((r) => r.status)
        .sort();
      expect(statuses).toEqual([201, 409]);
      await expect(
        prisma.zone.create({
          data: { farmId: farmA, buildingId: b.id, name: 'Zone concurrente' },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
    });

    it('supports CRUD filtered by building, scoped to the farm', async () => {
      const { headers } = await actor('DIRECTEUR_FERME');
      const b1 = (
        await http().post('/api/buildings').set(headers).send(building())
      ).body as BuildingItem;
      const b2 = (
        await http()
          .post('/api/buildings')
          .set(headers)
          .send(building({ name: 'Autre bât.' }))
      ).body as BuildingItem;
      const z = await http()
        .post('/api/zones')
        .set(headers)
        .send({ buildingId: b1.id, name: 'Zone 1', capacity: 100 })
        .expect(201);
      await http()
        .post('/api/zones')
        .set(headers)
        .send({ buildingId: b2.id, name: 'Zone 1' })
        .expect(201);
      const zoneId = (z.body as { id: string }).id;
      const list = await http()
        .get(`/api/zones?buildingId=${b1.id}`)
        .set(headers)
        .expect(200);
      expect((list.body as { total: number }).total).toBe(1);
      expect(
        (
          (await http().get(`/api/buildings/${b1.id}`).set(headers))
            .body as BuildingItem
        ).zones,
      ).toBe(1);

      await http()
        .patch(`/api/zones/${zoneId}`)
        .set(headers)
        .send({ name: 'Zone 1 bis', capacity: 50 })
        .expect(200);
      await http()
        .post('/api/zones')
        .set(headers)
        .send({ buildingId: b1.id, name: 'Zone 1 bis' })
        .expect(409);
      await http()
        .post('/api/zones')
        .set(headers)
        .send({ buildingId: b1.id, name: 'Z', capacity: 0 })
        .expect(400);

      // A building of another farm is rejected (400) and its zones are invisible (404).
      const foreignBuilding = await prisma.building.create({
        data: {
          farmId: farmB,
          siteId: siteB,
          name: 'B1',
          type: 'AUTRE',
          capacity: 5,
        },
      });
      const foreignZone = await prisma.zone.create({
        data: { farmId: farmB, buildingId: foreignBuilding.id, name: 'ZB' },
      });
      await http()
        .post('/api/zones')
        .set(headers)
        .send({ buildingId: foreignBuilding.id, name: 'Intrus' })
        .expect(400);
      await http()
        .patch(`/api/zones/${foreignZone.id}`)
        .set(headers)
        .send({ name: 'x' })
        .expect(404);
      await http()
        .delete(`/api/zones/${foreignZone.id}`)
        .set(headers)
        .expect(404);

      await http().delete(`/api/zones/${zoneId}`).set(headers).expect(200);
      const logs = await prisma.auditLog.findMany({
        where: { module: 'batiments' },
      });
      expect(
        logs.some((l) => l.action === 'DELETE' && l.recordId === zoneId),
      ).toBe(true);
    });
  });

  describe('farms', () => {
    it('lets SUPER_ADMIN create, rename, list and delete a farm (module fermes)', async () => {
      const admin = await actor('SUPER_ADMIN', [farmA]);
      const created = await http()
        .post('/api/farms')
        .set(admin.headers)
        .send({ name: 'Ferme C', location: 'Kpalimé' })
        .expect(201);
      const id = (created.body as { id: string }).id;
      expect(await prisma.site.count({ where: { farmId: id } })).toBe(0);
      await http()
        .patch(`/api/farms/${id}`)
        .set(admin.headers)
        .send({ active: false })
        .expect(200);
      const list = await http()
        .get('/api/farms?search=ferme c')
        .set(admin.headers)
        .expect(200);
      expect(
        (list.body as { items: { id: string; active: boolean }[] }).items,
      ).toMatchObject([{ id, active: false }]);
      await http()
        .post('/api/farms')
        .set(admin.headers)
        .send({ name: '' })
        .expect(400);
      await http().delete(`/api/farms/${id}`).set(admin.headers).expect(200);
      expect(
        (await prisma.auditLog.findMany({ where: { module: 'fermes' } })).map(
          (l) => l.action,
        ),
      ).toEqual(['CREATE', 'UPDATE', 'DELETE']);
    });

    it('lists every farm of the organisation for an all-farms role, none of another', async () => {
      const other = await createOrganization('Autre');
      await createFarm(other.id, 'Z');
      const owner = await actor('PROPRIETAIRE', []);
      const res = await http().get('/api/farms').set(owner.headers).expect(200);
      expect(
        (res.body as { items: { name: string }[] }).items
          .map((f) => f.name)
          .sort(),
      ).toEqual(['Ferme A', 'Ferme B']);
    });

    it('409 when the farm has buildings; 404 for another organisation; 403 for non-admins', async () => {
      const admin = await actor('SUPER_ADMIN');
      await http().post('/api/buildings').set(admin.headers).send(building());
      const del = await http()
        .delete(`/api/farms/${farmA}`)
        .set(admin.headers)
        .expect(409);
      expect((del.body as { message: string }).message).toBe(
        'Cette ferme contient des bâtiments',
      );
      // A farm without buildings (but with a site and an assignment) can go.
      await http().delete(`/api/farms/${farmB}`).set(admin.headers).expect(200);

      const other = await createOrganization('Autre');
      const foreign = await createFarm(other.id, 'Z');
      await http()
        .patch(`/api/farms/${foreign.id}`)
        .set(admin.headers)
        .send({ name: 'x' })
        .expect(404);
      await http()
        .delete(`/api/farms/${foreign.id}`)
        .set(admin.headers)
        .expect(404);

      const director = await actor('DIRECTEUR_FERME');
      await http().get('/api/farms').set(director.headers).expect(403);
      const owner = await actor('PROPRIETAIRE');
      await http()
        .post('/api/farms')
        .set(owner.headers)
        .send({ name: 'Nouvelle' })
        .expect(403);
    });
  });
});
