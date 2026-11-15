import { FinanceCategory, StockCategory } from '../generated/prisma/enums';
import {
  ACTIVITY_LABEL,
  CATEGORY_LABEL,
  EXPENSE_CATEGORIES,
  expenseCategoryOf,
  REVENUE_CATEGORIES,
} from './finance-categories';

describe('finance categories', () => {
  it('puts every category in exactly one of the two lists', () => {
    const all = Object.values(FinanceCategory);
    expect(all).toHaveLength(16);
    for (const c of all) {
      const inExpenses = EXPENSE_CATEGORIES.filter((x) => x === c).length;
      const inRevenues = REVENUE_CATEGORIES.filter((x) => x === c).length;
      expect(inExpenses + inRevenues).toBe(1);
    }
    expect(EXPENSE_CATEGORIES.length + REVENUE_CATEGORIES.length).toBe(
      all.length,
    );
  });

  it('labels every category with the exact French label', () => {
    expect(CATEGORY_LABEL).toEqual({
      ANIMAUX: 'Animaux',
      ALIMENT: 'Aliment',
      SANTE: 'Santé',
      MATERIEL: 'Matériel',
      CONSOMMABLES: 'Consommables',
      SALAIRES: 'Salaires',
      ENERGIE: 'Énergie',
      EAU: 'Eau',
      TRANSPORT: 'Transport',
      ENTRETIEN: 'Entretien',
      AUTRE_CHARGE: 'Autres charges',
      VENTE_ANIMAUX: "Ventes d'animaux",
      VENTE_OEUFS: "Ventes d'œufs",
      VENTE_ARTICLES: "Ventes d'articles",
      PRESTATIONS: 'Prestations',
      AUTRE_RECETTE: 'Autres recettes',
    });
    expect(ACTIVITY_LABEL).toEqual({
      AVICOLE: 'Avicole',
      PORCIN: 'Porcin',
      GENERAL: 'Général',
    });
  });

  it('maps every stock category to an expense category', () => {
    expect(
      Object.fromEntries(
        Object.values(StockCategory).map((c) => [c, expenseCategoryOf(c)]),
      ),
    ).toEqual({
      ALIMENT: 'ALIMENT',
      MEDICAMENT: 'SANTE',
      VACCIN: 'SANTE',
      MATERIEL: 'MATERIEL',
      CONSOMMABLE: 'CONSOMMABLES',
    });
    for (const c of Object.values(StockCategory)) {
      expect(EXPENSE_CATEGORIES).toContain(expenseCategoryOf(c));
    }
  });
});
