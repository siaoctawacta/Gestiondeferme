import type { RequestContext } from '../../access/decorators';
import { AlertsRegistry } from './alerts-registry';
import type { AlertItem, AlertSettings } from './alert.types';

const SETTINGS: AlertSettings = {
  mortalityDailyPct: 0.5,
  mortalityCumulPct: 3,
  consumptionDeviationPct: 25,
  farrowingWarningDays: 7,
};
const ctx = {} as RequestContext;
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

  it('is empty without rules', async () => {
    expect(await new AlertsRegistry().run(ctx, SETTINGS)).toEqual([]);
  });
});
