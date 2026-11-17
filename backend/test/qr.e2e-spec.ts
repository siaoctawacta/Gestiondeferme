import { INestApplication } from '@nestjs/common';
import QRCode from 'qrcode';
import { PrismaService } from '../src/prisma/prisma.service';
import { Headers, Id, Msg, World } from './fixtures';
import { createFarm, createOrganization, createUser, tokenFor } from './setup';
import { createTestApp } from './setup';

interface Target {
  kind: string;
  id: string;
  farmId: string | null;
  farmName: string | null;
  path: string;
  url: string;
  label: string;
  sublabel: string;
  svg: string;
}

const UNKNOWN = 'QR code inconnu ou inaccessible';

describe('QR codes (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let world: World;
  let admin: Headers;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = new PrismaService();
    world = new World(app, prisma);
  });

  beforeEach(async () => {
    await world.reset();
    admin = await world.actor('SUPER_ADMIN');
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  const http = () => world.http();
  const resolve = (h: Headers, kind: string, id: string) =>
    http().get(`/api/qr/${kind}/${id}`).set(h);
  const labels = (h: Headers, kind: string, ids: string[]) =>
    http().post('/api/qr/labels').set(h).send({ kind, ids });

  async function equipment(over: Record<string, unknown> = {}) {
    return prisma.equipment.create({
      data: {
        farmId: world.farmId,
        name: 'Groupe électrogène 20 kVA',
        type: 'GROUPE_ELECTROGENE',
        siteId: world.siteId,
        ...over,
      },
    });
  }

  async function article(name = 'Vaccin Gumboro') {
    return world.post<Id>(admin, '/stock-items', {
      name,
      category: 'VACCIN',
      unit: 'flacon',
    });
  }

  /** A user of another farm of the same organisation, and one of another organisation. */
  async function outsiders() {
    const farmB = await createFarm(world.orgId, 'Ferme B');
    const userB = await createUser({
      organizationId: world.orgId,
      role: 'DIRECTEUR_FERME',
      farmIds: [farmB.id],
    });
    const otherOrg = await createOrganization('Autre');
    const otherFarm = await createFarm(otherOrg.id, 'Ferme C');
    const userC = await createUser({
      organizationId: otherOrg.id,
      role: 'SUPER_ADMIN',
      farmIds: [otherFarm.id],
    });
    return {
      farmB,
      b: {
        Authorization: `Bearer ${await tokenFor(userB.id)}`,
        'X-Farm-Id': farmB.id,
      },
      c: {
        Authorization: `Bearer ${await tokenFor(userC.id)}`,
        'X-Farm-Id': otherFarm.id,
      },
    };
  }

  describe('GET /qr/:kind/:id', () => {
    it('resolves a poultry lot: path, url, labels and a QR of the url', async () => {
      const lot = await world.lot(admin);
      const res = await resolve(admin, 'lot', lot.id).expect(200);
      const t = res.body as Target;
      expect(t).toMatchObject({
        kind: 'lot',
        id: lot.id,
        farmId: world.farmId,
        farmName: 'Ferme A',
        path: `/m/lots/${lot.id}`,
        url: `http://localhost:5173/q/lot/${lot.id}`,
        label: lot.code,
        sublabel: 'Poulets de chair — Poulailler',
      });
      expect(t.svg).toContain('<svg');
      // The picture encodes the url and nothing else.
      expect(t.svg).toBe(
        await QRCode.toString(t.url, {
          type: 'svg',
          errorCorrectionLevel: 'M',
          margin: 1,
        }),
      );
    });

    it('resolves a pig lot, an animal, a building, an article and an equipment', async () => {
      const pigLot = await world.pigLot(admin);
      expect(
        (await resolve(admin, 'lot', pigLot.id).expect(200)).body,
      ).toMatchObject({
        path: `/m/porcs/lot-${pigLot.id}`,
      });
      const sow = await world.animal(admin);
      expect(
        (await resolve(admin, 'animal', sow.id).expect(200)).body,
      ).toMatchObject({
        path: `/m/porcs/${sow.id}`,
        label: sow.tag,
        sublabel: 'Truie',
      });
      expect(
        (await resolve(admin, 'batiment', world.poultryBld).expect(200)).body,
      ).toMatchObject({
        path: `/m/batiments/${world.poultryBld}`,
        label: 'Poulailler',
        sublabel: 'Avicole — Site A',
        farmName: 'Ferme A',
      });
      const art = await article();
      expect(
        (await resolve(admin, 'article', art.id).expect(200)).body,
      ).toEqual(
        expect.objectContaining({
          path: `/m/stocks/${art.id}`,
          label: 'Vaccin Gumboro',
          sublabel: 'Vaccin — flacon',
          farmId: null,
          farmName: null,
          url: `http://localhost:5173/q/article/${art.id}`,
        }),
      );
      const eq = await equipment();
      expect(
        (await resolve(admin, 'equipement', eq.id).expect(200)).body,
      ).toMatchObject({
        path: `/m/equipements/${eq.id}`,
        label: 'Groupe électrogène 20 kVA',
        sublabel: 'Groupe électrogène — Site A',
      });
    });

    it('needs the module of the record: COMMERCIAL reads a lot, MAGASINIER gets the 404', async () => {
      const lot = await world.lot(admin);
      const commercial = await world.actor('COMMERCIAL');
      await resolve(commercial, 'lot', lot.id).expect(200);
      const magasinier = await world.actor('MAGASINIER');
      const res = await resolve(magasinier, 'lot', lot.id).expect(404);
      const missing = await resolve(magasinier, 'lot', 'nope').expect(404);
      expect(res.body).toEqual(missing.body);
      expect((res.body as Msg).message).toBe(UNKNOWN);
    });

    it('answers a pig lot by the porcs module and a poultry lot by the lots module', async () => {
      const lot = await world.lot(admin);
      const pigLot = await world.pigLot(admin);
      const agentLots = await world.actor('RESP_AVICOLE');
      await resolve(agentLots, 'lot', lot.id).expect(200);
      await resolve(agentLots, 'lot', pigLot.id).expect(404);
      const pigs = await world.actor('RESP_PORCIN');
      await resolve(pigs, 'lot', pigLot.id).expect(200);
      await resolve(pigs, 'lot', lot.id).expect(404);
    });

    it('lets a veterinarian read an article, and refuses the module-less roles', async () => {
      const art = await article();
      const vet = await world.actor('VETERINAIRE');
      await resolve(vet, 'article', art.id).expect(200);
      const compta = await world.actor('COMPTABLE');
      await resolve(compta, 'article', art.id).expect(404);
    });

    it('is the same 404 for a record of another farm, another organisation and a missing id', async () => {
      const lot = await world.lot(admin);
      const eq = await equipment();
      const art = await article();
      const { b, c } = await outsiders();
      const bodies: unknown[] = [];
      for (const [h, kind, id] of [
        [b, 'lot', lot.id],
        [c, 'lot', lot.id],
        [b, 'equipement', eq.id],
        [c, 'article', art.id],
        [b, 'batiment', world.poultryBld],
        [admin, 'lot', 'cmissing'],
        [admin, 'animal', 'cmissing'],
        [admin, 'facture', lot.id],
        [admin, 'lot', lot.id + 'x'],
      ] as [Headers, string, string][]) {
        const res = await resolve(h, kind, id).expect(404);
        bodies.push(res.body);
      }
      for (const body of bodies) expect(body).toEqual(bodies[0]);
      expect((bodies[0] as Msg).message).toBe(UNKNOWN);
    });

    it('lets an all-farms role open a record of any farm of its organisation', async () => {
      const farmB = await createFarm(world.orgId, 'Ferme B');
      const siteB = await prisma.site.create({
        data: { farmId: farmB.id, name: 'Site B' },
      });
      const bldB = await prisma.building.create({
        data: {
          farmId: farmB.id,
          siteId: siteB.id,
          name: 'Poulailler B',
          type: 'AVICOLE',
          capacity: 10,
        },
      });
      const owner = await world.actor('PROPRIETAIRE');
      const res = await resolve(owner, 'batiment', bldB.id).expect(200);
      expect(res.body).toMatchObject({ farmId: farmB.id, farmName: 'Ferme B' });
      // A farm-scoped role of farm A cannot.
      const director = await world.actor('DIRECTEUR_FERME');
      await resolve(director, 'batiment', bldB.id).expect(404);
    });

    it('refuses a retired equipment', async () => {
      const eq = await equipment({ retiredAt: new Date('2026-01-10') });
      await resolve(admin, 'equipement', eq.id).expect(404);
    });

    it('needs a signed-in user', async () => {
      await http()
        .get('/api/qr/lot/x')
        .set({ 'X-Farm-Id': world.farmId })
        .expect(401);
    });
  });

  describe('POST /qr/labels', () => {
    it('returns the labels in the order of the ids', async () => {
      const a = await world.lot(admin);
      const b = await world.lot(admin);
      const c = await world.lot(admin);
      const res = await labels(admin, 'lot', [c.id, a.id, b.id]).expect(200);
      const body = res.body as { labels: Target[] };
      expect(body.labels.map((l) => l.id)).toEqual([c.id, a.id, b.id]);
      expect(body.labels.map((l) => l.label)).toEqual([c.code, a.code, b.code]);
      expect(body.labels[0].svg).toContain('<svg');
      expect(body.labels[0].url).toBe(`http://localhost:5173/q/lot/${c.id}`);
    });

    it('takes one to sixty ids', async () => {
      await labels(admin, 'lot', []).expect(400);
      const ids = Array.from({ length: 61 }, (_, i) => `id${i}`);
      await labels(admin, 'lot', ids).expect(400);
      await labels(admin, 'lot', ids.slice(0, 60)).expect(400);
      await labels(admin, 'facture', ['x']).expect(400);
      await labels(admin, 'lot', ['x', 'x']).expect(400);
      await http()
        .post('/api/qr/labels')
        .set(admin)
        .send({ kind: 'lot', ids: ['x'], extra: 1 })
        .expect(400);
    });

    it('refuses everything when one id is inaccessible, with the same message', async () => {
      const a = await world.lot(admin);
      const { b } = await outsiders();
      const res = await labels(admin, 'lot', [a.id, 'cmissing']).expect(400);
      expect((res.body as Msg).message).toBe(UNKNOWN);
      const foreign = await labels(b, 'lot', [a.id]).expect(400);
      expect((foreign.body as Msg).message).toBe(UNKNOWN);
    });

    it('checks the module of each lot against the caller', async () => {
      const lot = await world.lot(admin);
      const pigLot = await world.pigLot(admin);
      const resp = await world.actor('RESP_AVICOLE');
      await labels(resp, 'lot', [lot.id]).expect(200);
      const res = await labels(resp, 'lot', [lot.id, pigLot.id]).expect(400);
      expect((res.body as Msg).message).toBe(UNKNOWN);
      const magasinier = await world.actor('MAGASINIER');
      await labels(magasinier, 'lot', [lot.id]).expect(400);
      await labels(magasinier, 'article', [(await article()).id]).expect(200);
    });

    it('labels buildings, animals, articles and equipment too, skipping none', async () => {
      const sow = await world.animal(admin);
      const eq = await equipment();
      const retired = await equipment({
        name: 'Ancienne pompe',
        type: 'POMPE',
        retiredAt: new Date('2026-01-10'),
      });
      const art = await article();
      const bl = (
        await labels(admin, 'batiment', [
          world.poultryBld,
          world.pigBld,
        ]).expect(200)
      ).body as { labels: Target[] };
      expect(bl.labels.map((l) => l.label)).toEqual([
        'Poulailler',
        'Porcherie',
      ]);
      expect(
        (
          (await labels(admin, 'animal', [sow.id]).expect(200)).body as {
            labels: Target[];
          }
        ).labels[0].path,
      ).toBe(`/m/porcs/${sow.id}`);
      expect(
        (
          (await labels(admin, 'article', [art.id]).expect(200)).body as {
            labels: Target[];
          }
        ).labels[0].farmId,
      ).toBeNull();
      await labels(admin, 'equipement', [eq.id]).expect(200);
      await labels(admin, 'equipement', [eq.id, retired.id]).expect(400);
    });
  });
});
