import type { RequestContext } from '../../access/decorators';
import type { AlertSettings } from './alert.types';
import {
  healthAlertRules,
  otherHealthAlerts,
  vaccinationAlerts,
  type HealthActAlert,
} from './health-alerts';

const SETTINGS: AlertSettings = {
  vaccinationWarningDays: 3,
};
const NOW = new Date(Date.UTC(2026, 10, 15, 14, 30));

const act = (over: Partial<HealthActAlert> = {}): HealthActAlert => ({
  id: 'a1',
  type: 'VACCINATION',
  date: '2026-11-14',
  target: 'LC-2026-15',
  species: 'AVICOLE',
  productName: 'Gumboro',
  ...over,
});

describe('vaccinationAlerts', () => {
  it('raises Vaccination en retard (URGENT) for a planned vaccination before today', () => {
    expect(vaccinationAlerts([act()], SETTINGS, NOW)).toEqual([
      {
        key: 'vaccination:a1',
        title: 'Vaccination en retard',
        detail: 'LC-2026-15 — Gumboro',
        level: 'URGENT',
        module: 'sante',
        modules: ['sante', 'lots'],
      },
    ]);
  });

  it('raises Vaccination à venir (A_VOIR) from today up to and including the warning days', () => {
    const at = (date: string) =>
      vaccinationAlerts([act({ date })], SETTINGS, NOW);
    expect(at('2026-11-15')).toHaveLength(1);
    expect(at('2026-11-18')).toEqual([
      {
        key: 'vaccination:a1',
        title: 'Vaccination à venir',
        detail: 'LC-2026-15 — Gumboro (2026-11-18)',
        level: 'A_VOIR',
        module: 'sante',
        modules: ['sante', 'lots'],
      },
    ]);
    expect(at('2026-11-19')).toEqual([]);
  });

  it('files a pig target under porcs and a building target under sante alone', () => {
    const modules = (over: Partial<HealthActAlert>) =>
      vaccinationAlerts([act(over)], SETTINGS, NOW)[0].modules;
    expect(modules({ species: 'PORCIN' })).toEqual(['sante', 'porcs']);
    expect(modules({ species: undefined })).toEqual(['sante']);
  });

  it('leaves out the product when there is none', () => {
    const [late] = vaccinationAlerts(
      [act({ productName: null })],
      SETTINGS,
      NOW,
    );
    expect(late.detail).toBe('LC-2026-15');
  });

  it('lists URGENT before A_VOIR, then by date and target', () => {
    const keys = vaccinationAlerts(
      [
        act({ id: 'soon', date: '2026-11-16' }),
        act({ id: 'late2', date: '2026-11-13' }),
        act({ id: 'late1', date: '2026-11-10' }),
      ],
      SETTINGS,
      NOW,
    ).map((a) => a.key);
    expect(keys).toEqual([
      'vaccination:late1',
      'vaccination:late2',
      'vaccination:soon',
    ]);
  });
});

describe('otherHealthAlerts', () => {
  it('raises Désinfection en retard (A_VOIR) on a building', () => {
    expect(
      otherHealthAlerts(
        [
          act({
            id: 'd1',
            type: 'DESINFECTION',
            target: 'Porcherie 2',
            species: undefined,
            productName: 'Virkon S',
          }),
        ],
        NOW,
      ),
    ).toEqual([
      {
        key: 'health:d1',
        title: 'Désinfection en retard',
        detail: 'Porcherie 2 — Virkon S',
        level: 'A_VOIR',
        module: 'sante',
        modules: ['sante'],
      },
    ]);
  });

  it('raises Traitement en retard likewise, with the species module of a lot', () => {
    expect(
      otherHealthAlerts(
        [act({ id: 't1', type: 'TRAITEMENT', productName: 'Amoxicilline' })],
        NOW,
      ),
    ).toEqual([
      {
        key: 'health:t1',
        title: 'Traitement en retard',
        detail: 'LC-2026-15 — Amoxicilline',
        level: 'A_VOIR',
        module: 'sante',
        modules: ['sante', 'lots'],
      },
    ]);
  });

  it('is late exactly when the health list says EN_RETARD (no tolerance)', () => {
    const at = (date: string) =>
      otherHealthAlerts([act({ type: 'DESINFECTION', date })], NOW);
    expect(at('2026-11-14')).toHaveLength(1);
    expect(at('2026-11-15')).toEqual([]);
  });

  it('is not late today', () => {
    expect(
      otherHealthAlerts([act({ type: 'TRAITEMENT', date: '2026-11-15' })], NOW),
    ).toEqual([]);
  });
});

describe('healthAlertRules', () => {
  it('registers the vaccination rule then the other health rule', async () => {
    const calls: unknown[] = [];
    const rules = healthAlertRules(
      {
        vaccinations: (_ctx, _now, days) => {
          calls.push(days);
          return Promise.resolve([act()]);
        },
        lateActs: () =>
          Promise.resolve([act({ id: 't1', type: 'TRAITEMENT' })]),
      },
      () => NOW,
    );
    const ctx = {} as RequestContext;
    const [vaccination, other] = await Promise.all(
      rules.map((rule) => rule(ctx, SETTINGS)),
    );
    expect(rules).toHaveLength(2);
    expect(calls).toEqual([3]);
    expect(vaccination.map((a) => a.key)).toEqual(['vaccination:a1']);
    expect(other.map((a) => a.key)).toEqual(['health:t1']);
  });
});
