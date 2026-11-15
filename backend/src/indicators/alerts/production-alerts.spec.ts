import {
  consumptionAlerts,
  farrowingAlerts,
  mortalityAlerts,
  productionAlertRules,
  type AlertData,
  type ConsumptionSeries,
  type Gestation,
  type MortalityLot,
} from './production-alerts';
import type { RequestContext } from '../../access/decorators';
import type { AlertSettings } from './alert.types';

const SETTINGS: AlertSettings = {
  mortalityDailyPct: 0.5,
  mortalityCumulPct: 3,
  consumptionDeviationPct: 25,
  farrowingWarningDays: 7,
};
const NOW = new Date(Date.UTC(2026, 10, 14));

const lot = (over: Partial<MortalityLot> = {}): MortalityLot => ({
  id: 'b1',
  code: 'LC-0001',
  species: 'AVICOLE',
  initialCount: 5000,
  deaths: 0,
  recentDays: [],
  ...over,
});

describe('mortalityAlerts', () => {
  it('raises A_VOIR when the cumulative rate reaches the threshold', () => {
    expect(mortalityAlerts([lot({ deaths: 180 })], SETTINGS)).toEqual([
      {
        key: 'mortality:b1',
        title: 'Mortalité élevée LC-0001',
        detail: '3.6% sur 5000 sujets',
        level: 'A_VOIR',
        module: 'lots',
        modules: ['lots'],
      },
    ]);
  });

  it('raises nothing below the threshold, and again once it is lowered', () => {
    const l = lot({ deaths: 125 });
    expect(mortalityAlerts([l], SETTINGS)).toEqual([]);
    const lowered = { ...SETTINGS, mortalityCumulPct: 2 };
    const [alert] = mortalityAlerts([l], lowered);
    expect(alert.detail).toBe('2.5% sur 5000 sujets');
  });

  it('raises URGENT for a bad day and keeps one alert when both rules fire', () => {
    const day = { date: '2026-11-13', deaths: 30, liveAtStart: 4000 };
    const [only] = mortalityAlerts(
      [lot({ deaths: 30, recentDays: [day] })],
      SETTINGS,
    );
    expect(only).toMatchObject({
      level: 'URGENT',
      detail: "30 morts le 2026-11-13 (0.8% de l'effectif)",
    });
    const both = mortalityAlerts(
      [lot({ deaths: 180, recentDays: [day] })],
      SETTINGS,
    );
    expect(both).toHaveLength(1);
    expect(both[0].level).toBe('URGENT');
  });

  it('ignores a day below the daily threshold or without a live count', () => {
    const calm = { date: '2026-11-14', deaths: 1, liveAtStart: 4000 };
    const empty = { date: '2026-11-14', deaths: 5, liveAtStart: 0 };
    expect(
      mortalityAlerts([lot({ recentDays: [calm, empty] })], SETTINGS),
    ).toEqual([]);
  });

  it('files a pig lot under the pig module', () => {
    const [alert] = mortalityAlerts(
      [lot({ species: 'PORCIN', code: 'PE-0001', deaths: 200 })],
      SETTINGS,
    );
    expect(alert.module).toBe('porcs');
    expect(alert.modules).toEqual(['porcs']);
  });
});

describe('litter lots', () => {
  const deaths = { date: '2026-11-14', deaths: 2, liveAtStart: 12 };

  it('are not judged before weaning: pre-weaning loss is followed by the breeding figures', () => {
    const litter = lot({
      initialCount: 12,
      deaths: 2,
      recentDays: [deaths],
      litter: { weaned: false },
    });
    expect(mortalityAlerts([litter], SETTINGS)).toEqual([]);
  });

  it('are judged like any lot once weaned, whereas the same loss on a purchased lot alerts', () => {
    const weaned = lot({
      initialCount: 12,
      deaths: 2,
      recentDays: [deaths],
      litter: { weaned: true },
    });
    expect(mortalityAlerts([weaned], SETTINGS)[0]?.level).toBe('URGENT');
    const bought = lot({ initialCount: 12, deaths: 2, recentDays: [deaths] });
    expect(mortalityAlerts([bought], SETTINGS)[0]?.level).toBe('URGENT');
  });
});

describe('mortality thresholds are compared on raw rates', () => {
  it('cumulative: alerts at the threshold, not below, not by rounding', () => {
    const at = lot({ initialCount: 3000, deaths: 90 });
    expect(mortalityAlerts([at], SETTINGS)).toHaveLength(1);
    const below = lot({ initialCount: 3000, deaths: 89 });
    expect(mortalityAlerts([below], SETTINGS)).toEqual([]);
  });

  it('daily: alerts at the threshold, not below, not by rounding', () => {
    const day = (deaths: number) =>
      lot({
        recentDays: [{ date: '2026-11-14', deaths, liveAtStart: 2000 }],
      });
    expect(mortalityAlerts([day(10)], SETTINGS)[0]?.level).toBe('URGENT');
    expect(mortalityAlerts([day(9)], SETTINGS)).toEqual([]);
  });
});

describe('farrowingAlerts', () => {
  const sow = (expected: string): Gestation => ({
    id: 'r1',
    sowTag: 'TR-001',
    expectedFarrowingDate: expected,
  });
  const one = (expected: string) =>
    farrowingAlerts([sow(expected)], SETTINGS, NOW);

  it('is A_VOIR inside the warning window, including the due day', () => {
    expect(one('2026-11-17')).toEqual([
      {
        key: 'farrowing:r1',
        title: 'Mise bas TR-001',
        detail: 'Prévue dans 3 j (2026-11-17)',
        level: 'A_VOIR',
        module: 'reproduction',
        modules: ['reproduction'],
      },
    ]);
    expect(one('2026-11-14')[0]).toMatchObject({
      level: 'A_VOIR',
      detail: 'Prévue dans 0 j (2026-11-14)',
    });
    expect(one('2026-11-21')).toHaveLength(1);
  });

  it('is URGENT the day after the due date', () => {
    expect(one('2026-11-13')[0]).toMatchObject({
      level: 'URGENT',
      detail: 'Dépassée depuis 1 j (2026-11-13)',
    });
  });

  it('is silent when farrowing is further away', () => {
    expect(one('2026-11-22')).toEqual([]);
  });
});

describe('consumptionAlerts', () => {
  const series = (
    over: Partial<ConsumptionSeries> = {},
  ): ConsumptionSeries => ({
    kind: 'feed',
    target: 'LOT',
    species: 'AVICOLE',
    targetId: 't1',
    label: 'LC-0001',
    date: '2026-11-13',
    value: 140,
    previous: [100, 100, 100, 100],
    ...over,
  });

  it('flags a day above the average by the deviation threshold', () => {
    expect(consumptionAlerts([series()], SETTINGS)).toEqual([
      {
        key: 'consumption:t1:2026-11-13:feed',
        title: 'Consommation anormale LC-0001',
        detail: 'Aliment : 140 kg (moyenne 100 kg)',
        level: 'A_VOIR',
        module: 'alimentation',
        modules: ['alimentation', 'lots'],
      },
    ]);
  });

  it('asks for the species module too on a lot of the other species, and only alimentation on a building', () => {
    const modules = (over: Partial<ConsumptionSeries>) =>
      consumptionAlerts([series(over)], SETTINGS)[0].modules;
    expect(modules({ target: 'LOT', species: 'PORCIN' })).toEqual([
      'alimentation',
      'porcs',
    ]);
    expect(modules({ target: 'BATIMENT', species: undefined })).toEqual([
      'alimentation',
    ]);
  });

  it('flags a drop too, and water with its own wording', () => {
    expect(consumptionAlerts([series({ value: 60 })], SETTINGS)).toHaveLength(
      1,
    );
    const [water] = consumptionAlerts(
      [series({ kind: 'water', value: 130 })],
      SETTINGS,
    );
    expect(water.detail).toBe('Eau : 130 L (moyenne 100 L)');
    expect(water.key).toBe('consumption:t1:2026-11-13:water');
  });

  it('compares the raw deviation: exact threshold alerts, just under does not', () => {
    expect(consumptionAlerts([series({ value: 125 })], SETTINGS)).toHaveLength(
      1,
    );
    expect(consumptionAlerts([series({ value: 75 })], SETTINGS)).toHaveLength(
      1,
    );
    expect(consumptionAlerts([series({ value: 124.9 })], SETTINGS)).toEqual([]);
    expect(consumptionAlerts([series({ value: 124.96 })], SETTINGS)).toEqual(
      [],
    );
  });

  it('judges a series with exactly 3 prior days', () => {
    expect(
      consumptionAlerts([series({ previous: [100, 100, 100] })], SETTINGS),
    ).toHaveLength(1);
  });

  it('stays silent inside the tolerance or with fewer than 3 prior days', () => {
    expect(consumptionAlerts([series({ value: 120 })], SETTINGS)).toEqual([]);
    expect(
      consumptionAlerts([series({ previous: [100, 100] })], SETTINGS),
    ).toEqual([]);
    expect(
      consumptionAlerts([series({ previous: [0, 0, 0] })], SETTINGS),
    ).toEqual([]);
  });
});

describe('productionAlertRules', () => {
  it('builds mortality, farrowing and consumption rules in that order, reading the injected now', async () => {
    const seen: string[] = [];
    const data: AlertData = {
      mortalityLots: (_ctx, now) => {
        seen.push(`mortality ${now.toISOString()}`);
        return Promise.resolve([lot({ deaths: 180 })]);
      },
      gestations: () => {
        seen.push('gestations');
        return Promise.resolve([
          { id: 'r1', sowTag: 'TR-001', expectedFarrowingDate: '2026-11-10' },
        ]);
      },
      consumption: (_ctx, now) => {
        seen.push(`consumption ${now.toISOString()}`);
        return Promise.resolve([]);
      },
    };
    const rules = productionAlertRules(data, () => NOW);
    expect(rules).toHaveLength(3);
    const ctx = {} as RequestContext;
    const [m, f, c] = await Promise.all(rules.map((r) => r(ctx, SETTINGS)));
    expect(m[0].key).toBe('mortality:b1');
    expect(f[0]).toMatchObject({
      key: 'farrowing:r1',
      detail: 'Dépassée depuis 4 j (2026-11-10)',
    });
    expect(c).toEqual([]);
    expect(seen).toContain(`mortality ${NOW.toISOString()}`);
    expect(seen).toContain(`consumption ${NOW.toISOString()}`);
  });
});
