import type { RequestContext } from '../access/decorators';
import { parseDay } from '../common/days';
import {
  equipmentAlertRules,
  equipmentAlerts,
  type AlertEquipment,
  type EquipmentAlertData,
} from './equipment-alerts';

const NOW = new Date(Date.UTC(2026, 10, 14, 9, 0));
const TODAY = parseDay('2026-11-14') as Date;
const eq = (
  id: string,
  name: string,
  condition: AlertEquipment['condition'],
  next: string | null,
  farmName?: string,
): AlertEquipment => ({
  id,
  name,
  condition,
  nextMaintenance: next ? parseDay(next) : null,
  openBreakdownId: condition === 'EN_PANNE' ? `bd-${id}` : null,
  ...(farmName ? { farmName } : {}),
});
const REFERENCE = [
  eq('g', 'Groupe électrogène 20 kVA', 'BON', '2026-10-30'),
  eq('c', 'Couveuse 1200 œufs', 'A_SURVEILLER', '2026-10-25'),
  eq('p', 'Pompe forage', 'BON', '2026-11-15'),
  eq('v', 'Ventilateur Poulailler B #3', 'EN_PANNE', '2026-10-20'),
];

describe('equipmentAlerts', () => {
  it('raises the breakdown (URGENT) first, then the dues by date', () => {
    expect(equipmentAlerts(REFERENCE, TODAY, 0)).toEqual([
      {
        key: 'breakdown:v:bd-v',
        title: 'Équipement en panne',
        detail: 'Ventilateur Poulailler B #3',
        level: 'URGENT',
        module: 'equipements',
        modules: ['equipements'],
      },
      {
        key: 'maintenance:c:2026-10-25',
        title: 'Maintenance due',
        detail: 'Couveuse 1200 œufs',
        level: 'A_VOIR',
        module: 'equipements',
        modules: ['equipements'],
      },
      {
        key: 'maintenance:g:2026-10-30',
        title: 'Maintenance due',
        detail: 'Groupe électrogène 20 kVA',
        level: 'A_VOIR',
        module: 'equipements',
        modules: ['equipements'],
      },
    ]);
  });

  it('follows the warning days and never raises a due for a broken equipment', () => {
    const keys = equipmentAlerts(REFERENCE, TODAY, 1).map((a) => a.key);
    expect(keys).toEqual([
      'breakdown:v:bd-v',
      'maintenance:c:2026-10-25',
      'maintenance:g:2026-10-30',
      'maintenance:p:2026-11-15',
    ]);
  });

  it('orders breakdowns by name, dues by date then name, and names the farm when given', () => {
    const alerts = equipmentAlerts(
      [
        eq('2', 'B pompe', 'EN_PANNE', null, 'Ferme B'),
        eq('1', 'A pompe', 'EN_PANNE', null),
        eq('4', 'Z', 'BON', '2026-11-01'),
        eq('3', 'A', 'BON', '2026-11-01'),
        eq('5', 'M', 'BON', null),
      ],
      TODAY,
      0,
    );
    expect(alerts.map((a) => a.key)).toEqual([
      'breakdown:1:bd-1',
      'breakdown:2:bd-2',
      'maintenance:3:2026-11-01',
      'maintenance:4:2026-11-01',
    ]);
    expect(alerts[1].detail).toBe('B pompe — Ferme B');
  });
});

describe('breakdown alert key', () => {
  it('carries the open breakdown id, so the next breakdown is a new alert', () => {
    const first = equipmentAlerts([eq('v', 'V', 'EN_PANNE', null)], TODAY, 0);
    const next = equipmentAlerts(
      [{ ...eq('v', 'V', 'EN_PANNE', null), openBreakdownId: 'other' }],
      TODAY,
      0,
    );
    expect(first[0].key).not.toBe(next[0].key);
    expect(next[0].key).toBe('breakdown:v:other');
  });

  it('falls back to the equipment id alone when no open breakdown is found', () => {
    const [alert] = equipmentAlerts(
      [{ ...eq('v', 'V', 'EN_PANNE', null), openBreakdownId: null }],
      TODAY,
      0,
    );
    expect(alert.key).toBe('breakdown:v');
  });
});

describe('equipmentAlertRules', () => {
  const ctx = (role: string) =>
    ({ user: { role } }) as unknown as RequestContext;
  const source = () => {
    let calls = 0;
    const data: EquipmentAlertData = {
      attention: () => {
        calls += 1;
        return Promise.resolve(REFERENCE);
      },
    };
    return { data, calls: () => calls };
  };

  it('reads once for a reader of equipements and uses the maintenanceWarningDays setting', async () => {
    const { data, calls } = source();
    const [rule] = equipmentAlertRules(data, () => NOW);
    expect(await rule(ctx('DIRECTEUR_FERME'), {})).toHaveLength(3);
    expect(
      await rule(ctx('DIRECTEUR_FERME'), { maintenanceWarningDays: 1 }),
    ).toHaveLength(4);
    expect(calls()).toBe(2);
  });

  it('reads nothing for a role that cannot read equipements', async () => {
    const { data, calls } = source();
    const [rule] = equipmentAlertRules(data, () => NOW);
    expect(await rule(ctx('COMMERCIAL'), {})).toEqual([]);
    expect(calls()).toBe(0);
  });
});
