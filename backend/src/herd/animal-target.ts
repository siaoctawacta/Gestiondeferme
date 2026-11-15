import { Injectable } from '@nestjs/common';
import { SourceRegistry } from '../common/source-registry';
import type { Species } from '../generated/prisma/enums';
import type { Prisma } from '../generated/prisma/client';

/** What `OperationTargets` needs to know about an animal an operation is recorded on. */
export interface AnimalTargetInfo {
  id: string;
  farmId: string;
  /** The animal's tag. */
  label: string;
  species: Species;
  buildingId: string;
  birthDate: Date | null;
  /** False once the animal has left the herd (sold, dead, culled). */
  active: boolean;
}

/**
 * Finds individual animals for `OperationTargets`. The pig module registers
 * one, so `herd` never imports it (same inversion as `OccupationRegistry`).
 */
export interface AnimalTargetResolver {
  /**
   * Takes the row lock that serialises changes to the animal and returns it,
   * or null when it is not in `farmIds` (the caller answers 400).
   */
  lockAnimal(
    tx: Prisma.TransactionClient,
    animalId: string,
    farmIds: string[],
  ): Promise<AnimalTargetInfo | null>;
}

@Injectable()
export class AnimalTargetRegistry extends SourceRegistry<AnimalTargetResolver> {
  constructor() {
    super('animaux ciblés', { mandatory: true });
  }
}
