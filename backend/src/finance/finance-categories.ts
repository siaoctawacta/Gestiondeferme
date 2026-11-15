import type {
  Activity,
  FinanceCategory,
  StockCategory,
} from '../generated/prisma/enums';

/** Categories of money going out, in the order the screens list them. */
export const EXPENSE_CATEGORIES: FinanceCategory[] = [
  'ANIMAUX',
  'ALIMENT',
  'SANTE',
  'MATERIEL',
  'CONSOMMABLES',
  'SALAIRES',
  'ENERGIE',
  'EAU',
  'TRANSPORT',
  'ENTRETIEN',
  'AUTRE_CHARGE',
];

/** Categories of money coming in. */
export const REVENUE_CATEGORIES: FinanceCategory[] = [
  'VENTE_ANIMAUX',
  'VENTE_OEUFS',
  'VENTE_ARTICLES',
  'PRESTATIONS',
  'AUTRE_RECETTE',
];

export const CATEGORY_LABEL: Record<FinanceCategory, string> = {
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
};

export const ACTIVITY_LABEL: Record<Activity, string> = {
  AVICOLE: 'Avicole',
  PORCIN: 'Porcin',
  GENERAL: 'Général',
};

const EXPENSE_OF_STOCK: Record<StockCategory, FinanceCategory> = {
  ALIMENT: 'ALIMENT',
  MEDICAMENT: 'SANTE',
  VACCIN: 'SANTE',
  MATERIEL: 'MATERIEL',
  CONSOMMABLE: 'CONSOMMABLES',
};

/** The expense category a received stock article counts under. */
export const expenseCategoryOf = (stock: StockCategory): FinanceCategory =>
  EXPENSE_OF_STOCK[stock];
