import type { RequestContext } from '../../access/decorators';
import type { Role } from '../../generated/prisma/enums';
import { AlertsRegistry } from './alerts-registry';
import type { AlertItem, AlertSettings } from './alert.types';

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
});

describe('AlertsRegistry', () => {
  it('orders URGENT first, then by rule registration order, then by key', async () => {
    const registry = new AlertsRegistry();
    registry.register(() =>
      Promise.resolve([item('a:2', 'A_VOIR'), item('a:1', 'A_VOIR')]),
    );
    registry.register(() =>
      Promise.resolve([item('b:1', 'URGENT'), item('b:0', 'A_VOIR')]),
    );
    registry.register(() => Promise.resolve([item('c:1', 'URGENT')]));
    const keys = (await registry.run(ctx, SETTINGS)).map((i) => i.key);
    expect(keys).toEqual(['b:1', 'c:1', 'a:1', 'a:2', 'b:0']);
  });

  it('keeps only the alerts of modules the role can read, and counts them', async () => {
    const registry = new AlertsRegistry();
    const of = (module: AlertItem['module'], key: string): AlertItem => ({
      ...item(key, 'A_VOIR'),
      module,
    });
    registry.register(() =>
      Promise.resolve([
        of('lots', 'm:1'),
        of('reproduction', 'f:1'),
        of('alimentation', 'c:1'),
      ]),
    );
    const as = (role: Role) =>
      registry.run({ user: { role } } as RequestContext, SETTINGS);
    expect((await as('COMMERCIAL')).map((i) => i.key)).toEqual(['m:1']);
    expect((await as('DIRECTEUR_FERME')).map((i) => i.key)).toEqual([
      'c:1',
      'f:1',
      'm:1',
    ]);
    expect(await as('COMPTABLE')).toEqual([]);
  });

  it('is empty without rules', async () => {
    expect(await new AlertsRegistry().run(ctx, SETTINGS)).toEqual([]);
  });
});
