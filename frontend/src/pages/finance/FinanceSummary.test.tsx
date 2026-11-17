import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { SharedFiltersContext } from '../../components/module/sharedFilters';
import { FinanceSummary } from './FinanceSummary';
import { monthToDate } from './period';

vi.mock('../../lib/query', () => ({
  useFarmQuery: () => ({ data: undefined, isError: false, isPending: true }),
}));

describe('FinanceSummary first render', () => {
  it('shows the month to date at once, with no « Choisissez une période » flash, when opened without a period', () => {
    // Effects do not run in a string render: what it prints is exactly the first frame.
    const html = renderToString(
      <SharedFiltersContext.Provider value={{ params: ['from', 'to'], values: { from: '', to: '' }, set: () => undefined, error: null }}>
        <FinanceSummary />
      </SharedFiltersContext.Provider>,
    );
    const month = monthToDate();
    expect(html).toContain(`value="${month.from}"`);
    expect(html).toContain(`value="${month.to}"`);
    expect(html).not.toContain('Choisissez une période');
  });
});
