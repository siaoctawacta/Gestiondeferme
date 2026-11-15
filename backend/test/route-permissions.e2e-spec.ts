import { INestApplication, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { DiscoveryModule, DiscoveryService, Reflector } from '@nestjs/core';
import { PERMISSION_KEY } from '../src/access/decorators';
import { can, type ModuleKey } from '../src/access/permissions';
import type { Role } from '../src/generated/prisma/enums';
import { PrismaService } from '../src/prisma/prisma.service';
import { daysAgo, Headers, Id, World } from './fixtures';
import { createTestApp } from './setup';

interface Route {
  controller: string;
  handler: string;
  method: 'get' | 'post' | 'patch' | 'delete';
  path: string;
  module: ModuleKey | null;
}

/**
 * Walks every route of the controllers: the species of a lot is only known at
 * request time, so the herd routes (`@AnyAuthenticated` + a manual check) are
 * the ones a forgotten check would slip through unnoticed.
 */
describe('Route permissions walk (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let world: World;
  let routes: Route[];

  beforeAll(async () => {
    app = await createTestApp([DiscoveryModule]);
    prisma = new PrismaService();
    world = new World(app, prisma);
    const discovery = app.get(DiscoveryService);
    const reflector = app.get(Reflector);
    routes = [];
    for (const wrapper of discovery.getControllers()) {
      const instance = wrapper.instance as object | undefined;
      if (!instance) continue;
      const proto = Object.getPrototypeOf(instance) as Record<string, unknown>;
      const base = Reflect.getMetadata(
        PATH_METADATA,
        instance.constructor,
      ) as string;
      for (const name of Object.getOwnPropertyNames(proto)) {
        const handler = proto[name];
        if (typeof handler !== 'function') continue;
        const method = Reflect.getMetadata(METHOD_METADATA, handler) as
          RequestMethod | undefined;
        if (method === undefined) continue;
        const path = Reflect.getMetadata(PATH_METADATA, handler) as string;
        const required = reflector.getAllAndOverride<
          { module: ModuleKey } | undefined
        >(PERMISSION_KEY, [handler, instance.constructor]);
        routes.push({
          controller: instance.constructor.name,
          handler: name,
          method: RequestMethod[method].toLowerCase() as Route['method'],
          path: `/${base}/${path}`.replace(/\/+/g, '/').replace(/\/$/, ''),
          module: required?.module ?? null,
        });
      }
    }
  });

  beforeEach(async () => {
    await world.reset();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  const HERD = ['BatchesController', 'WeighingsController'];

  /** A body each herd route accepts, so validation does not answer before the permission check. */
  const SAMPLE: Record<string, object> = {
    'post /batches': {
      species: 'AVICOLE',
      type: 'CHAIR',
      buildingId: 'x',
      entryDate: '2026-01-01',
      initialCount: 1,
    },
    'patch /batches/:id': { notes: 'x' },
    'post /batches/:id/close': {},
    'post /batches/:id/reopen': {},
    'post /batches/:id/transfer': {
      toBuildingId: 'x',
      date: '2026-01-01',
      quantity: 1,
    },
    'post /batches/:id/events': {
      type: 'MORTALITE',
      date: '2026-01-01',
      quantity: 1,
    },
    'patch /batches/:id/events/:eventId': { quantity: 1 },
    'post /batches/:id/weighings': {
      date: '2026-01-01',
      sampleSize: 1,
      averageWeightG: 1,
    },
    'patch /batches/:id/weighings/:weighingId': { averageWeightG: 1 },
  };

  async function fixtures(species: 'AVICOLE' | 'PORCIN') {
    const director = await world.actor('DIRECTEUR_FERME');
    const lot =
      species === 'AVICOLE'
        ? await world.lot(director)
        : await world.pigLot(director);
    const event = await world.post<Id>(director, `/batches/${lot.id}/events`, {
      type: 'MORTALITE',
      date: daysAgo(3),
      quantity: 1,
    });
    const weighing = await world.post<Id>(
      director,
      `/batches/${lot.id}/weighings`,
      { date: daysAgo(3), sampleSize: 5, averageWeightG: 400 },
    );
    return { lot, event, weighing };
  }

  async function walkHerd(
    species: 'AVICOLE' | 'PORCIN',
    role: Role,
    fx: Awaited<ReturnType<typeof fixtures>>,
  ) {
    const headers: Headers = await world.actor(role);
    const herd = routes.filter((r) => HERD.includes(r.controller));
    const checked: string[] = [];
    const wrong: string[] = [];
    const missing: string[] = [];
    for (const r of herd) {
      // Creating a batch names its species in the body, not in an existing lot.
      const isCreate = r.method === 'post' && r.path === '/batches';
      const isList = r.method === 'get' && r.path === '/batches';
      const url = r.path
        .replace(':id', fx.lot.id)
        .replace(':eventId', fx.event.id)
        .replace(':weighingId', fx.weighing.id);
      const key = `${r.method} ${r.path}`;
      let body: object | undefined;
      if (r.method === 'post' || r.method === 'patch') {
        body = SAMPLE[key];
        if (!body) {
          missing.push(key);
          continue;
        }
      }
      let req = world
        .http()
        [r.method](`/api${url}${isList ? `?species=${species}` : ''}`)
        .set(headers);
      if (body) {
        const sent = isCreate
          ? { ...body, species, buildingId: world.otherBld }
          : body;
        req = req.send(sent);
      }
      const res = await req;
      checked.push(key);
      if (res.status !== 403)
        wrong.push(`${role} ${key} (${species}) -> ${res.status}`);
    }
    return { checked, wrong, missing };
  }

  it('covers every herd route (a new route needs a body sample here)', async () => {
    const fx = await fixtures('AVICOLE');
    const { missing, checked } = await walkHerd('AVICOLE', 'COMPTABLE', fx);
    expect(missing).toEqual([]);
    expect(checked.length).toBeGreaterThanOrEqual(15);
  });

  it('refuses a role with no lots permission on every poultry lot route', async () => {
    const fx = await fixtures('AVICOLE');
    expect((await walkHerd('AVICOLE', 'COMPTABLE', fx)).wrong).toEqual([]);
  });

  it('refuses a pig-only manager on every poultry lot route', async () => {
    const fx = await fixtures('AVICOLE');
    expect((await walkHerd('AVICOLE', 'RESP_PORCIN', fx)).wrong).toEqual([]);
  });

  it('refuses a poultry-only manager on every pig lot route', async () => {
    const fx = await fixtures('PORCIN');
    expect((await walkHerd('PORCIN', 'RESP_AVICOLE', fx)).wrong).toEqual([]);
  });

  describe('breeds', () => {
    const breedRoutes = () =>
      routes.filter((r) => r.controller === 'BreedsController');

    it('covers every route of the controller', () => {
      expect(
        breedRoutes()
          .map((r) => `${r.method} ${r.path}`)
          .sort(),
      ).toEqual([
        'delete /breeds/:id',
        'get /breeds',
        'patch /breeds/:id',
        'post /breeds',
      ]);
    });

    async function breeds() {
      const director = await world.actor('DIRECTEUR_FERME');
      const poultry = await world.post<Id>(director, '/breeds', {
        name: 'Isa Brown',
        species: 'AVICOLE',
      });
      const pig = await world.post<Id>(director, '/breeds', {
        name: 'Large White',
        species: 'PORCIN',
      });
      return { poultry, pig };
    }

    const call = (
      headers: Headers,
      r: Route,
      ids: { poultry: Id; pig: Id },
      species: 'AVICOLE' | 'PORCIN',
    ) => {
      const id = species === 'AVICOLE' ? ids.poultry.id : ids.pig.id;
      const body =
        r.method === 'post'
          ? { name: 'Autre', species }
          : r.method === 'patch'
            ? { name: 'Renommée' }
            : undefined;
      let req = world
        .http()
        [r.method](`/api${r.path.replace(':id', id)}`)
        .set(headers);
      if (body) req = req.send(body);
      return req;
    };

    it('refuses a role that reads neither species on every route', async () => {
      const ids = await breeds();
      const headers = await world.actor('COMPTABLE');
      const wrong: string[] = [];
      for (const r of breedRoutes()) {
        const res = await call(headers, r, ids, 'AVICOLE');
        if (res.status !== 403)
          wrong.push(`${r.method} ${r.path} ${res.status}`);
      }
      expect(wrong).toEqual([]);
    });

    it("refuses writes on the other species' breeds, while reading stays open", async () => {
      const ids = await breeds();
      const cases: [Role, 'AVICOLE' | 'PORCIN'][] = [
        ['RESP_PORCIN', 'AVICOLE'],
        ['RESP_AVICOLE', 'PORCIN'],
      ];
      const wrong: string[] = [];
      for (const [role, species] of cases) {
        const headers = await world.actor(role);
        for (const r of breedRoutes()) {
          const res = await call(headers, r, ids, species);
          const expected = r.method === 'get' ? 200 : 403;
          if (res.status !== expected) {
            wrong.push(`${role} ${r.method} ${r.path} ${res.status}`);
          }
        }
      }
      expect(wrong).toEqual([]);
    });
  });

  describe('modules of the other controllers', () => {
    const FAMILY: Record<string, ModuleKey[]> = {
      AnimalsController: ['porcs'],
      HerdListController: ['porcs'],
      BreedingController: ['reproduction'],
      AnimalReproductionController: ['reproduction', 'porcs'],
      EggProductionController: ['ponte'],
      IncubationsController: ['ponte'],
      FeedProductsController: ['alimentation'],
      FeedFormulasController: ['alimentation'],
      FeedDistributionsController: ['alimentation'],
      WaterController: ['alimentation'],
      StockItemsController: ['stocks'],
      StockMovementsController: ['stocks'],
      StockOverviewController: ['stocks'],
      InventoriesController: ['stocks'],
    };

    it('states the module of its family on every route, and the guard refuses a role without it', async () => {
      const wrongModule: string[] = [];
      const notRefused: string[] = [];
      const noRole = new Map<ModuleKey, Headers>();
      for (const r of routes.filter((x) => x.controller in FAMILY)) {
        if (!r.module || !FAMILY[r.controller].includes(r.module)) {
          wrongModule.push(
            `${r.controller}.${r.handler} -> ${String(r.module)}`,
          );
          continue;
        }
        const module = r.module;
        if (!noRole.has(module)) {
          const role = (['COMPTABLE', 'MAGASINIER'] as Role[]).find(
            (x) => !can(x, module, 'read'),
          );
          noRole.set(module, await world.actor(role!));
        }
        const url = r.path.replace(/:\w+/g, 'x');
        const res = await world
          .http()
          [r.method](`/api${url}`)
          .set(noRole.get(module)!)
          .send({});
        if (res.status !== 403)
          notRefused.push(`${r.method} ${r.path} -> ${res.status}`);
      }
      expect(wrongModule).toEqual([]);
      expect(notRefused).toEqual([]);
    });

    it('walks at least the routes of every family', () => {
      const seen = new Set(routes.map((r) => r.controller));
      for (const controller of Object.keys(FAMILY)) {
        expect(seen.has(controller)).toBe(true);
      }
    });
  });
});
