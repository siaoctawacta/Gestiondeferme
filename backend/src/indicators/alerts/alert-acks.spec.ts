import { hides } from './alert-acks';

const DAY = 86_400_000;
const at = new Date('2026-11-17T10:00:00Z');
const ack = (level: 'A_VOIR' | 'URGENT', daysAgo: number) => ({
  level,
  acknowledgedAt: new Date(at.getTime() - daysAgo * DAY),
});

describe('hides', () => {
  it('hides for fewer than `days` days, shows at exactly `days`', () => {
    expect(hides(ack('A_VOIR', 0), 'A_VOIR', at, 7)).toBe(true);
    expect(hides(ack('A_VOIR', 6.99), 'A_VOIR', at, 7)).toBe(true);
    expect(hides(ack('A_VOIR', 7), 'A_VOIR', at, 7)).toBe(false);
    expect(hides(ack('A_VOIR', 30), 'A_VOIR', at, 7)).toBe(false);
  });

  it('shows an alert again when its level got worse, never when it got better', () => {
    expect(hides(ack('A_VOIR', 1), 'URGENT', at, 7)).toBe(false);
    expect(hides(ack('URGENT', 1), 'A_VOIR', at, 7)).toBe(true);
    expect(hides(ack('URGENT', 1), 'URGENT', at, 7)).toBe(true);
  });

  it('follows the number of days it is given', () => {
    expect(hides(ack('A_VOIR', 2), 'A_VOIR', at, 3)).toBe(true);
    expect(hides(ack('A_VOIR', 2), 'A_VOIR', at, 2)).toBe(false);
    expect(hides(ack('A_VOIR', 0.5), 'A_VOIR', at, 1)).toBe(true);
  });
});
