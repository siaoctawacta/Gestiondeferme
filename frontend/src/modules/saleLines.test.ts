import { describe, expect, it } from 'vitest';
import { saleLinesToPayload, sellableOptions, type Sellable } from './saleLines';

const source = (over: Partial<Sellable>): Sellable => ({
  id: 's1', kind: 'LOT', label: 'LC-2026-14 — Poulets de chair (4 820 vivants)', designation: 'Poulets de chair', unit: null, available: 4820,
  withdrawalUntil: null, sellable: true, reason: null, ...over,
});

describe('sellableOptions', () => {
  it('names the whole plateaux an egg source holds, beside its label', () => {
    const [option] = sellableOptions({ items: [source({ kind: 'OEUFS', label: 'LP-2026-03 — 4 710 œufs disponibles', available: 4710, eggsPerTray: 30, availableTrays: 157 })] });
    expect(option.label).toBe('LP-2026-03 — 4 710 œufs disponibles (157 plateaux)');
  });

  it('says plateau in the singular for one, and adds nothing to a source without trays', () => {
    const [one, lot] = sellableOptions({ items: [source({ kind: 'OEUFS', label: 'LP — 45 œufs disponibles', availableTrays: 1 }), source({})] });
    expect(one.label).toBe('LP — 45 œufs disponibles (1 plateau)');
    expect(lot.label).toBe('LC-2026-14 — Poulets de chair (4 820 vivants)');
  });

  it('keeps an unsellable source visible, disabled, with its reason', () => {
    const [option] = sellableOptions({ items: [source({ sellable: false, reason: "Délai d'attente" })] });
    expect(option).toMatchObject({ disabled: true, label: "LC-2026-14 — Poulets de chair (4 820 vivants) (Délai d'attente)" });
  });
});

describe('saleLinesToPayload', () => {
  const row = (over: Record<string, string>) => ({ kind: 'LOT', sourceId: 'l1', designation: 'Poulets', unit: '', quantity: '3', unitPrice: '100', ...over });

  it('sends a unit for egg lines only: a lot, an animal, an article and a service never carry one', () => {
    const lines = saleLinesToPayload([
      row({}), row({ kind: 'ANIMAL', sourceId: 'a1', unit: 'kg' }), row({ kind: 'ARTICLE', sourceId: 'i1', unit: 'kg' }),
      row({ kind: 'SERVICE', sourceId: '', unit: 'kg' }), row({ kind: 'OEUFS', sourceId: 'l2', unit: 'PLATEAU' }),
    ]);
    expect(lines.map((l) => 'unit' in l)).toEqual([false, false, false, false, true]);
    expect(lines[4]).toMatchObject({ kind: 'OEUFS', batchId: 'l2', unit: 'PLATEAU' });
  });
});
