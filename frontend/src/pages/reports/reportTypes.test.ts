import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reportParams } from './reportTypes';

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-17T10:00:00Z')); });
afterEach(() => vi.useRealTimers());

describe('reportParams', () => {
  it('sends nothing for the synthèse', () => {
    expect(reportParams({ type: 'synthese', date: '2026-10-01' })).toEqual({});
  });
  it('defaults the day types to today and keeps a chosen day', () => {
    expect(reportParams({ type: 'quotidien' })).toEqual({ date: '2026-11-17' });
    expect(reportParams({ type: 'hebdomadaire' })).toEqual({ date: '2026-11-17' });
    expect(reportParams({ type: 'hebdomadaire', date: '2026-10-22' })).toEqual({ date: '2026-10-22' });
  });
  it('sends the first day of the month and of the year', () => {
    expect(reportParams({ type: 'mensuel' })).toEqual({ date: '2026-11-01' });
    expect(reportParams({ type: 'mensuel', date: '2026-10-15' })).toEqual({ date: '2026-10-01' });
    expect(reportParams({ type: 'annuel' })).toEqual({ date: '2026-01-01' });
    expect(reportParams({ type: 'annuel', date: '2025-06-01' })).toEqual({ date: '2025-01-01' });
  });
  it('defaults sanitaire and zootechnique to the month to date', () => {
    expect(reportParams({ type: 'sanitaire' })).toEqual({ from: '2026-11-01', to: '2026-11-17' });
    expect(reportParams({ type: 'zootechnique', from: '2026-10-01', to: '2026-10-31' })).toEqual({ from: '2026-10-01', to: '2026-10-31' });
  });
});
