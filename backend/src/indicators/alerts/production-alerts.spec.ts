import {
  consumptionAlerts,
  farrowingAlerts,
  mortalityAlerts,
  type ConsumptionSeries,
  type Gestation,
  type MortalityLot,
} from './production-alerts';
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
      },
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
