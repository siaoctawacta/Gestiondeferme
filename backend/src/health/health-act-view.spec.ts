import { parseDay } from '../common/days';
import { toActItem, withdrawalEnd, type ActRow } from './health-act-view';

const day = (s: string) => parseDay(s) as Date;

describe('withdrawalEnd', () => {
  const done = {
    status: 'REALISE' as const,
    doneDate: day('2026-11-10'),
    durationDays: 5,
    withdrawalDays: 7,
  };

  it('is the done date plus the treatment days plus the withdrawal days', () => {
    expect(withdrawalEnd(done)).toEqual(day('2026-11-22'));
  });

  it('counts the withdrawal alone when no duration is given, and is the done day itself for 0 days', () => {
    expect(withdrawalEnd({ ...done, durationDays: null })).toEqual(
      day('2026-11-17'),
    );
    expect(
      withdrawalEnd({ ...done, durationDays: null, withdrawalDays: 0 }),
    ).toEqual(day('2026-11-10'));
  });

  it('is null without a withdrawal period, and for acts that are not done', () => {
    expect(withdrawalEnd({ ...done, withdrawalDays: null })).toBeNull();
    expect(withdrawalEnd({ ...done, status: 'PLANIFIE' })).toBeNull();
    expect(
      withdrawalEnd({ ...done, status: 'ANNULE', doneDate: null }),
    ).toBeNull();
  });
});

describe('toActItem status', () => {
  const row = (over: Partial<ActRow>): ActRow =>
    ({
      id: 'a',
      date: day('2026-11-14'),
      doneDate: null,
      enteredDone: false,
      status: 'PLANIFIE',
      type: 'VACCINATION',
      batchId: 'b',
      animalId: null,
      buildingId: null,
      batch: { code: 'LC-1', status: 'EN_COURS' },
      animal: null,
      building: null,
      quantity: null,
      durationDays: null,
      withdrawalDays: null,
      ...over,
    }) as ActRow;
  const now = day('2026-11-15');

  it('carries the stored enteredDone flag', () => {
    expect(toActItem(row({ enteredDone: true }), now).enteredDone).toBe(true);
    expect(toActItem(row({}), now).enteredDone).toBe(false);
  });

  it('derives EN_RETARD for a planned act dated before today only', () => {
    expect(toActItem(row({}), now).status).toBe('EN_RETARD');
    expect(toActItem(row({ date: day('2026-11-15') }), now).status).toBe(
      'PLANIFIE',
    );
    expect(toActItem(row({ date: day('2026-11-16') }), now).status).toBe(
      'PLANIFIE',
    );
  });

  it('does not mark late a planned act whose lot is closed or animal gone', () => {
    const closed = row({ batch: { code: 'LC-1', status: 'CLOTURE' } });
    expect(toActItem(closed, now).status).toBe('PLANIFIE');
    const gone = row({
      batchId: null,
      batch: null,
      animalId: 'x',
      animal: { tag: 'T', status: 'VENDU' },
    });
    expect(toActItem(gone, now).status).toBe('PLANIFIE');
    const live = row({
      batchId: null,
      batch: null,
      animalId: 'x',
      animal: { tag: 'T', status: 'GESTANTE' },
    });
    expect(toActItem(live, now).status).toBe('EN_RETARD');
  });

  it('never marks a done or cancelled act late', () => {
    expect(
      toActItem(row({ status: 'REALISE', doneDate: day('2026-11-14') }), now)
        .status,
    ).toBe('REALISE');
    expect(toActItem(row({ status: 'ANNULE' }), now).status).toBe('ANNULE');
  });
});
