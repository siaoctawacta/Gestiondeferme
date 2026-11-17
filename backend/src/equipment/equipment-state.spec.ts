import { BadRequestException, ConflictException } from '@nestjs/common';
import { parseDay } from '../common/days';
import {
  conditionGuard,
  maintenanceDue,
  nextMaintenance,
  type InterventionDates,
} from './equipment-state';

const day = (value: string): Date => parseDay(value) as Date;
const done = (
  date: string,
  nextDate: string | null,
  created = '2026-11-01T08:00:00Z',
): InterventionDates => ({ date, nextDate, createdAt: new Date(created) });
const FIRST = {
  firstMaintenanceDate: '2026-10-30',
  maintenanceIntervalDays: 90,
};

describe('nextMaintenance', () => {
  it('is the first date while nothing was done', () => {
    expect(nextMaintenance(FIRST, [])).toBe('2026-10-30');
    expect(
      nextMaintenance(
        { firstMaintenanceDate: '2026-10-30', maintenanceIntervalDays: null },
        [],
      ),
    ).toBe('2026-10-30');
  });

  it('is null without a first date, an interval or an intervention', () => {
    expect(
      nextMaintenance(
        { firstMaintenanceDate: null, maintenanceIntervalDays: null },
        [],
      ),
    ).toBeNull();
    expect(
      nextMaintenance(
        { firstMaintenanceDate: null, maintenanceIntervalDays: 30 },
        [],
      ),
    ).toBeNull();
  });

  it('is the next date the latest intervention gave', () => {
    expect(nextMaintenance(FIRST, [done('2026-11-10', '2027-02-10')])).toBe(
      '2027-02-10',
    );
  });

  it('adds the interval to a latest intervention that gave no next date', () => {
    expect(
      nextMaintenance(FIRST, [
        done('2026-11-10', '2027-02-10'),
        done('2026-12-01', null),
      ]),
    ).toBe('2027-03-01');
  });

  it('is null after an intervention without next date on an equipment without interval', () => {
    expect(
      nextMaintenance(
        { firstMaintenanceDate: '2026-10-30', maintenanceIntervalDays: null },
        [done('2026-11-10', null)],
      ),
    ).toBeNull();
  });

  it('takes the latest by date, then by creation time, whatever the order given', () => {
    expect(
      nextMaintenance(FIRST, [
        done('2026-12-01', '2027-06-01'),
        done('2026-11-10', '2027-02-10'),
      ]),
    ).toBe('2027-06-01');
    expect(
      nextMaintenance(FIRST, [
        done('2026-12-01', '2027-01-01', '2026-12-01T10:00:00Z'),
        done('2026-12-01', '2027-02-01', '2026-12-01T09:00:00Z'),
      ]),
    ).toBe('2027-01-01');
  });
});

describe('maintenanceDue', () => {
  it('is due when the next date is at most today plus the warning days', () => {
    expect(maintenanceDue('2026-11-15', day('2026-11-14'), 0)).toBe(false);
    expect(maintenanceDue('2026-11-15', day('2026-11-14'), 1)).toBe(true);
    expect(maintenanceDue('2026-11-14', day('2026-11-14'), 0)).toBe(true);
    expect(maintenanceDue('2026-10-20', day('2026-11-14'), 0)).toBe(true);
  });

  it('is never due without a next date', () => {
    expect(maintenanceDue(null, day('2026-11-14'), 30)).toBe(false);
  });
});

describe('conditionGuard', () => {
  it('refuses to declare a breakdown by hand (400) and to leave it by hand (409)', () => {
    expect(() => conditionGuard('BON', 'EN_PANNE')).toThrow(
      new BadRequestException("L'état « En panne » se déclare par une panne"),
    );
    expect(() => conditionGuard('A_SURVEILLER', 'EN_PANNE')).toThrow(
      BadRequestException,
    );
    expect(() => conditionGuard('EN_PANNE', 'BON')).toThrow(
      new ConflictException(
        'Un équipement en panne est remis en service par une intervention corrective',
      ),
    );
    expect(() => conditionGuard('EN_PANNE', 'A_SURVEILLER')).toThrow(
      ConflictException,
    );
  });

  it('lets BON and A_SURVEILLER change into each other, and a state stay as it is', () => {
    expect(() => conditionGuard('BON', 'A_SURVEILLER')).not.toThrow();
    expect(() => conditionGuard('A_SURVEILLER', 'BON')).not.toThrow();
    expect(() => conditionGuard('EN_PANNE', 'EN_PANNE')).not.toThrow();
    expect(() => conditionGuard('BON', 'BON')).not.toThrow();
  });
});
