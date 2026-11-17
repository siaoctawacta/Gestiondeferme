import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { OWED_STATUSES } from '../purchases/purchase-workflow';
import { REVENUE_STATUSES } from '../sales/sale-workflow';
import { isDerivedId, likePattern } from './finance-rules';
import { EXPENSE_CATEGORIES, REVENUE_CATEGORIES } from './finance-categories';

const MIGRATIONS = join(__dirname, '..', '..', 'prisma', 'migrations');

/** The SQL of the last migration that (re)defines `needle`. */
function latestSql(needle: string | RegExp): string {
  const found = readdirSync(MIGRATIONS)
    .filter((d) => /^\d+_/.test(d))
    .sort()
    .map((d) => readFileSync(join(MIGRATIONS, d, 'migration.sql'), 'utf8'))
    .filter((sql) =>
      typeof needle === 'string' ? sql.includes(needle) : needle.test(sql),
    );
  if (found.length === 0) throw new Error(`no migration defines ${needle}`);
  return found[found.length - 1];
}

const quoted = (list: readonly string[]) =>
  list.map((c) => `'${c}'`).join(', ');

describe('finance ledger SQL', () => {
  const view = latestSql(/CREATE( OR REPLACE)? VIEW "FinanceLedgerView"/);
  const table = latestSql('CREATE TABLE "FinanceEntry"');

  it('keeps the CHECK category lists of the table equal to finance-categories.ts', () => {
    expect(table).toContain(`"category" IN (${quoted(EXPENSE_CATEGORIES)})`);
    expect(table).toContain(`"category" IN (${quoted(REVENUE_CATEGORIES)})`);
  });

  it('reads invoices and credit notes in the revenue statuses of the sales workflow', () => {
    const statuses = `IN (${quoted(REVENUE_STATUSES)})`;
    expect(view.split(statuses)).toHaveLength(3);
  });

  it('reads purchases in the owed statuses of the purchase workflow', () => {
    expect(view).toContain(`IN (${quoted(OWED_STATUSES)})`);
  });

  it('defines one branch per origin', () => {
    for (const origin of [
      'MANUEL',
      'ACHAT',
      'LOT',
      'FACTURE',
      'AVOIR',
      'MAINTENANCE',
    ]) {
      expect(view.split(`'${origin}'`).length - 1).toBe(1);
    }
  });
});

describe('finance ledger helpers', () => {
  it('recognises the ids of derived rows, and only those', () => {
    for (const id of [
      'achat:p:ALIMENT',
      'lot:b',
      'facture:i:AVICOLE:X',
      'avoir:c:A:B',
      'maintenance:m',
    ]) {
      expect(isDerivedId(id)).toBe(true);
    }
    for (const id of ['ckx1abc', 'cm9k0000000000000000', 'lots', 'factures']) {
      expect(isDerivedId(id)).toBe(false);
    }
  });

  it('searches text, not patterns', () => {
    expect(likePattern('ceet')).toBe('%ceet%');
    expect(likePattern('100%')).toBe('%100\\%%');
    expect(likePattern('a_b\\c')).toBe('%a\\_b\\\\c%');
  });
});
