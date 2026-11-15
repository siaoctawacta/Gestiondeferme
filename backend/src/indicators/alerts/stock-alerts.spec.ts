import type { RequestContext } from '../../access/decorators';
import type { AlertSettings } from './alert.types';
import {
  expiryAlerts,
  stockAlertRules,
  stockLevelAlerts,
  type ExpiringBatch,
  type StockLevelRow,
} from './stock-alerts';

const SETTINGS: AlertSettings = { expiryWarningDays: 30 };
const NOW = new Date(Date.UTC(2026, 10, 15, 14, 30));

const row = (over: Partial<StockLevelRow> = {}): StockLevelRow => ({
  farmId: 'f1',
  itemId: 'i1',
  name: 'Aliment ponte',
  unit: 'kg',
  quantity: 900,
  minQty: 1500,
  ...over,
});
const batch = (over: Partial<ExpiringBatch> = {}): ExpiringBatch => ({
  id: 'sb1',
  itemName: 'Vaccin Gumboro',
  lotNumber: 'L-42',
  expiryDate: '2026-12-15',
  quantity: 10,
  ...over,
});

describe('stockLevelAlerts', () => {
  it('raises Stock faible (A_VOIR) below the threshold, with the reference texts', () => {
    expect(stockLevelAlerts([row()])).toEqual([
      {
        key: 'stock:f1:i1',
        title: 'Stock faible : Aliment ponte',
        detail: '900 kg (seuil 1500)',
        level: 'A_VOIR',
        module: 'stocks',
        modules: ['stocks'],
      },
    ]);
  });

  it('raises Stock critique (URGENT) below half of the threshold', () => {
    expect(
      stockLevelAlerts([
        row({
          itemId: 'i2',
          name: 'Aliment engraissement porc',
          quantity: 600,
        }),
      ]),
    ).toEqual([
      {
        key: 'stock:f1:i2',
        title: 'Stock critique : Aliment engraissement porc',
        detail: '600 kg (seuil 1500)',
        level: 'URGENT',
        module: 'stocks',
        modules: ['stocks'],
      },
    ]);
  });

  it('follows the boundaries of the level function', () => {
    const titleAt = (quantity: number, minQty = 1500) =>
      stockLevelAlerts([row({ quantity, minQty })]).map((a) => a.title);
    expect(titleAt(1500)).toEqual([]);
    expect(titleAt(1499.99)).toEqual(['Stock faible : Aliment ponte']);
    expect(titleAt(750)).toEqual(['Stock faible : Aliment ponte']);
    expect(titleAt(749.99)).toEqual(['Stock critique : Aliment ponte']);
    expect(titleAt(0)).toEqual(['Stock critique : Aliment ponte']);
  });

  it('raises nothing for an article without threshold', () => {
    expect(stockLevelAlerts([row({ minQty: 0, quantity: 0 })])).toEqual([]);
  });

  it('lists URGENT before A_VOIR, then by article name', () => {
    const titles = stockLevelAlerts([
      row({ itemId: 'a', name: 'Zinc', quantity: 1000 }),
      row({ itemId: 'b', name: 'Avoine', quantity: 1000 }),
      row({ itemId: 'c', name: 'Maïs', quantity: 100 }),
    ]).map((a) => a.title);
    expect(titles).toEqual([
      'Stock critique : Maïs',
      'Stock faible : Avoine',
      'Stock faible : Zinc',
    ]);
  });
});

describe('expiryAlerts', () => {
  const alertsFor = (expiryDate: string, quantity = 10) =>
    expiryAlerts([batch({ expiryDate, quantity })], SETTINGS, NOW);

  it('raises Produit bientôt périmé (A_VOIR) up to and including the warning days', () => {
    expect(alertsFor('2026-12-15')).toEqual([
      {
        key: 'expiry:sb1',
        title: 'Produit bientôt périmé : Vaccin Gumboro',
        detail: 'Lot L-42 — expire le 2026-12-15',
        level: 'A_VOIR',
        module: 'stocks',
        modules: ['stocks'],
      },
    ]);
    expect(alertsFor('2026-12-16')).toEqual([]);
  });

  it('warns on the expiry day itself (today is not yet past)', () => {
    expect(alertsFor('2026-11-15').map((a) => [a.title, a.level])).toEqual([
      ['Produit bientôt périmé : Vaccin Gumboro', 'A_VOIR'],
    ]);
  });

  it('raises Produit périmé (URGENT) from the day after', () => {
    const [alert] = alertsFor('2026-11-14');
    expect(alert).toMatchObject({
      key: 'expiry:sb1',
      title: 'Produit périmé : Vaccin Gumboro',
      detail: 'Lot L-42 — expiré le 2026-11-14',
      level: 'URGENT',
      modules: ['stocks'],
    });
  });

  it('ignores an empty lot, expired or not', () => {
    expect(alertsFor('2026-11-01', 0)).toEqual([]);
    expect(alertsFor('2026-11-20', 0)).toEqual([]);
  });

  it('names a lot without number', () => {
    const [alert] = expiryAlerts([batch({ lotNumber: null })], SETTINGS, NOW);
    expect(alert.detail).toBe('Lot sans numéro — expire le 2026-12-15');
  });

  it('follows the expiryWarningDays setting', () => {
    expect(expiryAlerts([batch()], { expiryWarningDays: 10 }, NOW)).toEqual([]);
  });

  it('lists URGENT before A_VOIR, then by expiry date and article', () => {
    const keys = expiryAlerts(
      [
        batch({ id: 'a', expiryDate: '2026-12-01' }),
        batch({ id: 'b', expiryDate: '2026-11-20' }),
        batch({ id: 'c', expiryDate: '2026-11-01' }),
      ],
      SETTINGS,
      NOW,
    ).map((a) => a.key);
    expect(keys).toEqual(['expiry:c', 'expiry:b', 'expiry:a']);
  });
});

describe('stockAlertRules', () => {
  it('registers the stock rule then the expiry rule over the loaders', async () => {
    const rules = stockAlertRules(
      {
        levels: () => Promise.resolve([row()]),
        batches: () => Promise.resolve([batch({ expiryDate: '2026-11-01' })]),
      },
      () => NOW,
    );
    const ctx = {} as RequestContext;
    const [stock, expiry] = await Promise.all(
      rules.map((rule) => rule(ctx, SETTINGS)),
    );
    expect(rules).toHaveLength(2);
    expect(stock.map((a) => a.key)).toEqual(['stock:f1:i1']);
    expect(expiry.map((a) => a.key)).toEqual(['expiry:sb1']);
  });
});
