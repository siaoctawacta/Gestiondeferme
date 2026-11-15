import type {
  AnimalCategory,
  Activity,
  BatchType,
  FinanceCategory,
  SaleLineKind,
  Species,
} from '../generated/prisma/enums';

/** The branch a line belongs to: a lot's species, animals are pigs, eggs are poultry, the rest is general. */
export function lineActivity(kind: SaleLineKind, species?: Species): Activity {
  switch (kind) {
    case 'LOT':
      return species === 'PORCIN' ? 'PORCIN' : 'AVICOLE';
    case 'ANIMAL':
      return 'PORCIN';
    case 'OEUFS':
      return 'AVICOLE';
    default:
      return 'GENERAL';
  }
}

/** The revenue category a line is counted in. */
export function lineCategory(kind: SaleLineKind): FinanceCategory {
  switch (kind) {
    case 'LOT':
    case 'ANIMAL':
      return 'VENTE_ANIMAUX';
    case 'OEUFS':
      return 'VENTE_OEUFS';
    case 'ARTICLE':
      return 'VENTE_ARTICLES';
    case 'SERVICE':
      return 'PRESTATIONS';
  }
}

/** The eggs a line moves: its quantity (trays or eggs) × the eggs per unit snapshotted on it. */
export const eggsOf = (line: {
  quantity: number;
  eggsPerUnit: number;
}): number => line.quantity * line.eggsPerUnit;

const BATCH_LABEL: Record<BatchType, string> = {
  CHAIR: 'Poulets de chair',
  PONDEUSE: 'Poules de réforme',
  POUSSIN: 'Poussins',
  REPRODUCTEUR: 'Reproducteurs',
  PORCELET: 'Porcelets',
  ENGRAISSEMENT: 'Porcs',
};

const ANIMAL_LABEL: Record<AnimalCategory, string> = {
  TRUIE: 'Truie',
  VERRAT: 'Verrat',
  COCHETTE: 'Cochette',
};

/** What names a line when the user gives no designation. */
export interface LineSource {
  batchType?: BatchType;
  animalCategory?: AnimalCategory;
  tag?: string;
  unit?: string | null;
  name?: string;
}

export function defaultDesignation(
  kind: SaleLineKind,
  source: LineSource,
): string {
  switch (kind) {
    case 'LOT':
      return source.batchType ? BATCH_LABEL[source.batchType] : '';
    case 'ANIMAL':
      return source.animalCategory
        ? `${ANIMAL_LABEL[source.animalCategory]} ${source.tag ?? ''}`.trim()
        : (source.tag ?? '');
    case 'OEUFS':
      return source.unit === 'PLATEAU' ? 'Œufs (plateau)' : 'Œufs';
    case 'ARTICLE':
      return source.name ?? '';
    case 'SERVICE':
      return '';
  }
}

/** Lots that lay (the rule of the egg records): poultry layers and breeders. */
export const canLay = (batch: { species: Species; type: BatchType }): boolean =>
  batch.species === 'AVICOLE' &&
  (batch.type === 'PONDEUSE' || batch.type === 'REPRODUCTEUR');

export interface LineInput {
  kind: SaleLineKind;
  batchId?: string | null;
  animalId?: string | null;
  stockItemId?: string | null;
  designation?: string | null;
  weightKg?: number | null;
  quantity: number;
}

/** The ids a kind of line must (and may only) carry. */
const SOURCE_IDS: Record<
  SaleLineKind,
  ('batchId' | 'animalId' | 'stockItemId')[]
> = {
  LOT: ['batchId'],
  ANIMAL: ['animalId'],
  OEUFS: ['batchId'],
  ARTICLE: ['stockItemId'],
  SERVICE: [],
};

const MISSING: Record<SaleLineKind, string> = {
  LOT: 'Choisissez un lot',
  ANIMAL: 'Choisissez un animal',
  OEUFS: 'Choisissez le lot des œufs',
  ARTICLE: 'Choisissez un article',
  SERVICE: 'Indiquez la désignation de la prestation',
};

/** The 400 message of a line whose shape the database would refuse, null when it is well formed. */
export function lineShapeError(line: LineInput): string | null {
  const wanted = SOURCE_IDS[line.kind];
  if (line.kind === 'SERVICE') {
    if (!line.designation?.trim()) return MISSING.SERVICE;
  } else if (wanted.some((id) => !line[id])) {
    return MISSING[line.kind];
  }
  const ids = ['batchId', 'animalId', 'stockItemId'] as const;
  if (ids.some((id) => line[id] && !wanted.includes(id))) {
    return 'Les références de la ligne ne correspondent pas à son type';
  }
  if (
    (line.kind === 'LOT' || line.kind === 'OEUFS') &&
    !Number.isInteger(line.quantity)
  ) {
    return 'La quantité doit être un nombre entier';
  }
  if (line.kind === 'ANIMAL' && line.quantity !== 1) {
    return 'Une ligne Animal vend un seul animal';
  }
  if (
    line.weightKg !== undefined &&
    line.weightKg !== null &&
    line.kind !== 'LOT' &&
    line.kind !== 'ANIMAL'
  ) {
    return 'Le poids ne concerne que les lots et les animaux';
  }
  return null;
}
