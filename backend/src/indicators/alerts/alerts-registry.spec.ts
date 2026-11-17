import type { RequestContext } from '../../access/decorators';
import type { Role } from '../../generated/prisma/enums';
import { AlertsRegistry } from './alerts-registry';
import { ALERT_RANK, type AlertItem, type AlertSettings } from './alert.types';

const SETTINGS: AlertSettings = {
  mortalityDailyPct: 0.5,
  mortalityCumulPct: 3,
  consumptionDeviationPct: 25,
  farrowingWarningDays: 7,
};
const ctx = { user: { role: 'DIRECTEUR_FERME' } } as RequestContext;
const item = (key: string, level: AlertItem['level']): AlertItem => ({
  key,
  title: key,
  detail: '',
  level,
  module: 'lots',
  modules: ['lots'],
});

describe('AlertsRegistry', () => {
  it("orders URGENT first, then by rule registration order within a rank, then in each rule's own order", async () => {
    const registry = new AlertsRegistry();
    registry.register(
      () => Promise.resolve([item('a:2', 'A_VOIR'), item('a:1', 'A_VOIR')]),
      ALERT_RANK.STOCK,
    );
    registry.register(
      () => Promise.resolve([item('b:1', 'URGENT'), item('b:0', 'A_VOIR')]),
      ALERT_RANK.STOCK,
    );
    registry.register(
      () => Promise.resolve([item('c:1', 'URGENT')]),
      ALERT_RANK.STOCK,
    );
    const keys = (await registry.run(ctx, SETTINGS)).map((i) => i.key);
    expect(keys).toEqual(['b:1', 'c:1', 'a:2', 'a:1', 'b:0']);
  });

  it('orders by level, then by module rank, whatever the registration order', async () => {
    const registry = new AlertsRegistry();
    registry.register(
      () => Promise.resolve([item('sales:1', 'A_VOIR')]),
      ALERT_RANK.SALES,
    );
    registry.register(
      () => Promise.resolve([item('stock:1', 'A_VOIR')]),
      ALERT_RANK.STOCK,
    );
    registry.register(
      () =>
        Promise.resolve([
          item('prod:2', 'A_VOIR'),
          item('prod:1', 'A_VOIR'),
          item('prod:u', 'URGENT'),
        ]),
      ALERT_RANK.PRODUCTION,
    );
    registry.register(
      () => Promise.resolve([item('sales:u', 'URGENT')]),
      ALERT_RANK.SALES,
    );
    registry.register(
      () => Promise.resolve([item('stock:u', 'URGENT')]),
      ALERT_RANK.STOCK,
    );
    registry.register(
      () => Promise.resolve([item('health:1', 'A_VOIR')]),
      ALERT_RANK.HEALTH,
    );
    const keys = (await registry.run(ctx, SETTINGS)).map((i) => i.key);
    expect(keys).toEqual([
      'stock:u',
      'prod:u',
      'sales:u',
      'stock:1',
      'prod:2',
      'prod:1',
      'health:1',
      'sales:1',
    ]);
  });

  it('keeps registration order between rules of the same rank', async () => {
    const registry = new AlertsRegistry();
    registry.register(
      () => Promise.resolve([item('b', 'A_VOIR')]),
      ALERT_RANK.TASKS,
    );
    registry.register(
      () => Promise.resolve([item('a', 'A_VOIR')]),
      ALERT_RANK.TASKS,
    );
    expect((await registry.run(ctx, SETTINGS)).map((i) => i.key)).toEqual([
      'b',
      'a',
    ]);
  });

  it('keeps only the alerts of modules the role can read, and counts them', async () => {
    const registry = new AlertsRegistry();
    const of = (module: AlertItem['module'], key: string): AlertItem => ({
      ...item(key, 'A_VOIR'),
      module,
      modules: [module],
    });
    registry.register(
      () =>
        Promise.resolve([
          of('lots', 'm:1'),
          of('reproduction', 'f:1'),
          of('alimentation', 'c:1'),
        ]),
      ALERT_RANK.STOCK,
    );
    const as = (role: Role) =>
      registry.run({ user: { role } } as RequestContext, SETTINGS);
    expect((await as('COMMERCIAL')).map((i) => i.key)).toEqual(['m:1']);
    expect((await as('DIRECTEUR_FERME')).map((i) => i.key)).toEqual([
      'm:1',
      'f:1',
      'c:1',
    ]);
    expect(await as('COMPTABLE')).toEqual([]);
  });

  it('needs every module of an alert to be readable by the role', async () => {
    const registry = new AlertsRegistry();
    const both: AlertItem = {
      ...item('c:both', 'A_VOIR'),
      module: 'alimentation',
      modules: ['alimentation', 'porcs'],
    };
    const building: AlertItem = {
      ...both,
      key: 'c:building',
      modules: ['alimentation'],
    };
    registry.register(
      () => Promise.resolve([both, building]),
      ALERT_RANK.STOCK,
    );
    const as = (role: Role) =>
      registry.run({ user: { role } } as RequestContext, SETTINGS);
    expect((await as('RESP_AVICOLE')).map((i) => i.key)).toEqual([
      'c:building',
    ]);
    expect((await as('RESP_PORCIN')).map((i) => i.key)).toEqual([
      'c:both',
      'c:building',
    ]);
  });

  it('shows an alert without any module to no one', async () => {
    const registry = new AlertsRegistry();
    registry.register(
      () =>
        Promise.resolve([
          {
            ...item('none:1', 'URGENT'),
            modules: [] as unknown as AlertItem['modules'],
          },
          item('some:1', 'A_VOIR'),
        ]),
      ALERT_RANK.STOCK,
    );
    for (const role of [
      'SUPER_ADMIN',
      'DIRECTEUR_FERME',
      'COMMERCIAL',
    ] as Role[]) {
      const keys = (
        await registry.run({ user: { role } } as RequestContext, SETTINGS)
      ).map((i) => i.key);
      expect(keys).not.toContain('none:1');
    }
  });

  it('is empty without rules', async () => {
    expect(await new AlertsRegistry().run(ctx, SETTINGS)).toEqual([]);
  });
});
