import type { ModuleKey } from '../access/permissions';
import { BatchType, Species } from '../generated/prisma/enums';

/** Permission module that governs a species' batches. */
export const speciesModule = (species: Species): ModuleKey =>
  species === 'AVICOLE' ? 'lots' : 'porcs';

export const TYPES_BY_SPECIES: Record<Species, BatchType[]> = {
  AVICOLE: ['CHAIR', 'PONDEUSE', 'POUSSIN', 'REPRODUCTEUR'],
  PORCIN: ['PORCELET', 'ENGRAISSEMENT'],
};
