import {
  defaultDesignation,
  eggsOf,
  lineActivity,
  lineCategory,
  lineShapeError,
} from './sale-lines';

describe('sale lines', () => {
  it('derives the activity of a line from its kind (and the lot species)', () => {
    expect(lineActivity('LOT', 'AVICOLE')).toBe('AVICOLE');
    expect(lineActivity('LOT', 'PORCIN')).toBe('PORCIN');
    expect(lineActivity('ANIMAL')).toBe('PORCIN');
    expect(lineActivity('OEUFS')).toBe('AVICOLE');
    expect(lineActivity('ARTICLE')).toBe('GENERAL');
    expect(lineActivity('SERVICE')).toBe('GENERAL');
  });

  it('puts every kind in its revenue category', () => {
    expect(lineCategory('LOT')).toBe('VENTE_ANIMAUX');
    expect(lineCategory('ANIMAL')).toBe('VENTE_ANIMAUX');
    expect(lineCategory('OEUFS')).toBe('VENTE_OEUFS');
    expect(lineCategory('ARTICLE')).toBe('VENTE_ARTICLES');
    expect(lineCategory('SERVICE')).toBe('PRESTATIONS');
  });

  it('counts the eggs of a line', () => {
    expect(eggsOf({ quantity: 400, eggsPerUnit: 30 })).toBe(12000);
    expect(eggsOf({ quantity: 90, eggsPerUnit: 1 })).toBe(90);
  });

  it('names a line after its source', () => {
    const lot = (
      batchType:
        | 'CHAIR'
        | 'PONDEUSE'
        | 'POUSSIN'
        | 'REPRODUCTEUR'
        | 'PORCELET'
        | 'ENGRAISSEMENT',
    ) => defaultDesignation('LOT', { batchType });
    expect(lot('CHAIR')).toBe('Poulets de chair');
    expect(lot('PONDEUSE')).toBe('Poules de réforme');
    expect(lot('POUSSIN')).toBe('Poussins');
    expect(lot('REPRODUCTEUR')).toBe('Reproducteurs');
    expect(lot('PORCELET')).toBe('Porcelets');
    expect(lot('ENGRAISSEMENT')).toBe('Porcs');
    expect(
      defaultDesignation('ANIMAL', { animalCategory: 'TRUIE', tag: 'TR-027' }),
    ).toBe('Truie TR-027');
    expect(
      defaultDesignation('ANIMAL', { animalCategory: 'VERRAT', tag: 'VR-002' }),
    ).toBe('Verrat VR-002');
    expect(
      defaultDesignation('ANIMAL', { animalCategory: 'COCHETTE', tag: 'CO-1' }),
    ).toBe('Cochette CO-1');
    expect(defaultDesignation('OEUFS', { unit: 'PLATEAU' })).toBe(
      'Œufs (plateau)',
    );
    expect(defaultDesignation('OEUFS', { unit: 'OEUF' })).toBe('Œufs');
    expect(defaultDesignation('ARTICLE', { name: 'Aliment ponte' })).toBe(
      'Aliment ponte',
    );
  });

  describe('lineShapeError', () => {
    const base = { designation: undefined, weightKg: undefined };
    it('wants the id that names the source, and no other', () => {
      expect(lineShapeError({ ...base, kind: 'LOT', quantity: 3 })).toBe(
        'Choisissez un lot',
      );
      expect(
        lineShapeError({ ...base, kind: 'LOT', batchId: 'b', quantity: 3 }),
      ).toBeNull();
      expect(
        lineShapeError({
          ...base,
          kind: 'LOT',
          batchId: 'b',
          animalId: 'a',
          quantity: 3,
        }),
      ).toBe('Les références de la ligne ne correspondent pas à son type');
      expect(lineShapeError({ ...base, kind: 'ANIMAL', quantity: 1 })).toBe(
        'Choisissez un animal',
      );
      expect(lineShapeError({ ...base, kind: 'ARTICLE', quantity: 1 })).toBe(
        'Choisissez un article',
      );
      expect(lineShapeError({ ...base, kind: 'OEUFS', quantity: 1 })).toBe(
        'Choisissez le lot des œufs',
      );
      expect(lineShapeError({ ...base, kind: 'SERVICE', quantity: 1 })).toBe(
        'Indiquez la désignation de la prestation',
      );
      expect(
        lineShapeError({
          ...base,
          kind: 'SERVICE',
          designation: 'Transport',
          quantity: 1.5,
        }),
      ).toBeNull();
    });

    it('sells whole birds and eggs, one animal per line, weight on animals only', () => {
      expect(
        lineShapeError({ ...base, kind: 'LOT', batchId: 'b', quantity: 2.5 }),
      ).toBe('La quantité doit être un nombre entier');
      expect(
        lineShapeError({ ...base, kind: 'OEUFS', batchId: 'b', quantity: 1.5 }),
      ).toBe('La quantité doit être un nombre entier');
      expect(
        lineShapeError({ ...base, kind: 'ANIMAL', animalId: 'a', quantity: 2 }),
      ).toBe('Une ligne Animal vend un seul animal');
      expect(
        lineShapeError({
          ...base,
          kind: 'ARTICLE',
          stockItemId: 's',
          quantity: 2,
          weightKg: 10,
        }),
      ).toBe('Le poids ne concerne que les lots et les animaux');
      expect(
        lineShapeError({
          ...base,
          kind: 'LOT',
          batchId: 'b',
          quantity: 2,
          weightKg: 10,
        }),
      ).toBeNull();
    });
  });
});
