import { BadRequestException } from '@nestjs/common';
import type { ModuleKey } from '../access/permissions';
import { BatchType, BuildingType, Species } from '../generated/prisma/enums';

/** Permission module that governs a species' batches. */
export const speciesModule = (species: Species): ModuleKey =>
  species === 'AVICOLE' ? 'lots' : 'porcs';

export const TYPES_BY_SPECIES: Record<Species, BatchType[]> = {
  AVICOLE: ['CHAIR', 'PONDEUSE', 'POUSSIN', 'REPRODUCTEUR'],
  PORCIN: ['PORCELET', 'ENGRAISSEMENT'],
};

export const WRONG_BUILDING = 'Ce bâtiment est réservé à une autre espèce';

/** 400 when a building of the other species is chosen; an `AUTRE` building takes both. */
export function assertBuildingFits(
  building: { type: BuildingType },
  species: Species,
): void {
  if (building.type !== 'AUTRE' && building.type !== species) {
    throw new BadRequestException(WRONG_BUILDING);
  }
}

/** The batch types that lay eggs (poultry layers and breeders): the one rule behind egg records, incubations and egg sales. */
export const LAYING_TYPES: BatchType[] = ['PONDEUSE', 'REPRODUCTEUR'];

export const canLay = (batch: { species: Species; type: BatchType }): boolean =>
  batch.species === 'AVICOLE' && LAYING_TYPES.includes(batch.type);
