import { Decimal } from '@prisma/client/runtime/client';
import type { RequestContext } from '../access/decorators';
import {
  receivableAlertRules,
  receivableAlerts,
  type OpenReceivable,
  type ReceivableAlertData,
} from './receivable-alerts';

const TODAY = '2026-11-15';

const row = (over: Partial<OpenReceivable> = {}): OpenReceivable => ({
  invoiceId: 'inv1',
  number: 'FA-0309',
  customerName: 'Marché Hédzranawoé — Mme Afi',
  status: 'PARTIELLE',
  due: new Decimal(400000),
  dueDate: '2026-11-14',
  ...over,
});

describe('receivableAlerts', () => {
  it('raises Créance FA-0309 (A_VOIR, ventes) with the reference texts the day after the due date', () => {
    expect(receivableAlerts([row()], TODAY)).toEqual([
      {
        key: 'receivable:inv1',
        title: 'Créance FA-0309',
        detail: 'Marché Hédzranawoé — Mme Afi — 400 000 FCFA',
        level: 'A_VOIR',
        module: 'ventes',
        modules: ['ventes'],
      },
    ]);
  });

  it('raises nothing on the due date itself, before it, without a due date, or when nothing is due', () => {
    expect(receivableAlerts([row({ dueDate: TODAY })], TODAY)).toEqual([]);
    expect(receivableAlerts([row({ dueDate: '2026-11-16' })], TODAY)).toEqual(
      [],
    );
    expect(receivableAlerts([row({ dueDate: null })], TODAY)).toEqual([]);
    expect(receivableAlerts([row({ due: new Decimal(0) })], TODAY)).toEqual([]);
  });

  it('only an issued or partly paid invoice is a receivable', () => {
    for (const status of ['BROUILLON', 'SOLDEE', 'ANNULEE'] as const) {
      expect(receivableAlerts([row({ status })], TODAY)).toEqual([]);
    }
    expect(receivableAlerts([row({ status: 'EMISE' })], TODAY)).toHaveLength(1);
  });

  it('writes the amount with thousands grouped and cents when there are some, and the farm under several farms', () => {
    const [a] = receivableAlerts(
      [row({ due: new Decimal('1050000.5'), farmName: 'Ferme B' })],
      TODAY,
    );
    expect(a.detail).toBe(
      'Marché Hédzranawoé — Mme Afi — 1 050 000.5 FCFA — Ferme B',
    );
  });

  it('is ordered by due date, then number, then key', () => {
    const items = receivableAlerts(
      [
        row({ invoiceId: 'c', number: 'FA-0003', dueDate: '2026-11-10' }),
        row({ invoiceId: 'b', number: 'FA-0002', dueDate: '2026-11-10' }),
        row({ invoiceId: 'a', number: 'FA-0001', dueDate: '2026-11-12' }),
        row({ invoiceId: 'z', number: 'FA-0002', dueDate: '2026-11-10' }),
      ],
      TODAY,
    );
    expect(items.map((i) => i.key)).toEqual([
      'receivable:b',
      'receivable:z',
      'receivable:c',
      'receivable:a',
    ]);
  });
});

describe('receivableAlertRules', () => {
  const ctx = { user: { role: 'COMPTABLE' } } as RequestContext;

  it('is one rule that asks the data for the invoices overdue on the day of `now` and applies the same rule', async () => {
    const overdue = jest.fn(() =>
      Promise.resolve([row(), row({ invoiceId: 'late', dueDate: TODAY })]),
    );
    const data: ReceivableAlertData = { overdue };
    const rules = receivableAlertRules(
      data,
      () => new Date(Date.UTC(2026, 10, 15, 23, 30)),
    );
    expect(rules).toHaveLength(1);
    const items = await rules[0](ctx, {});
    expect(items.map((i) => i.key)).toEqual(['receivable:inv1']);
    expect(overdue).toHaveBeenCalledTimes(1);
    expect(overdue).toHaveBeenCalledWith(ctx, new Date(Date.UTC(2026, 10, 15)));
  });

  it('does not read anything for a role without ventes read', async () => {
    const overdue = jest.fn(() => Promise.resolve([row()]));
    const [rule] = receivableAlertRules({ overdue });
    const keeper = { user: { role: 'MAGASINIER' } } as RequestContext;
    expect(await rule(keeper, {})).toEqual([]);
    expect(overdue).not.toHaveBeenCalled();
  });
});
