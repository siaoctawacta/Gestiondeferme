import { AnimalTargetRegistry } from './animal-target';
import { BatchHistoryRegistry } from './batch-history';
import { BatchPerformanceRegistry } from './batch-performance';
import { OccupationRegistry } from './occupation';
import { LotCostRegistry } from '../indicators/lot-cost';
import { AlertsRegistry } from '../indicators/alerts/alerts-registry';

describe('the application registries', () => {
  it.each([
    ['occupation', () => new OccupationRegistry()],
    ['performance des lots', () => new BatchPerformanceRegistry()],
    ['coûts des lots', () => new LotCostRegistry()],
    ['animaux ciblés', () => new AnimalTargetRegistry()],
  ])('refuses to boot without a source for "%s"', (name, make) => {
    expect(() => make().onApplicationBootstrap()).toThrow(name);
  });

  it.each([
    ['historique des lots', () => new BatchHistoryRegistry()],
    ['alertes', () => new AlertsRegistry()],
  ])('boots without a source for "%s"', (_name, make) => {
    expect(() => make().onApplicationBootstrap()).not.toThrow();
  });

  it('serves the batch performance through its single provider, and fails without one', async () => {
    const registry = new BatchPerformanceRegistry();
    const ctx = {} as never;
    expect(() => registry.get(ctx, 'b1')).toThrow('performance des lots');
    const performance = { alive: 3 } as never;
    registry.register({ batchPerformance: () => Promise.resolve(performance) });
    await expect(registry.get(ctx, 'b1')).resolves.toBe(performance);
  });
});
