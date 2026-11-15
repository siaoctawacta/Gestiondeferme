import { Injectable, OnModuleInit } from '@nestjs/common';
import { lockRow } from '../common/lock-row';
import type { Prisma } from '../generated/prisma/client';
import {
  AnimalTargetRegistry,
  type AnimalTargetInfo,
  type AnimalTargetResolver,
} from '../herd/animal-target';
import { LIVE_STATUSES } from './animals.service';

/** Lets `herd`'s `OperationTargets` find the individual pigs an operation is recorded on. */
@Injectable()
export class AnimalTargets implements AnimalTargetResolver, OnModuleInit {
  constructor(private readonly registry: AnimalTargetRegistry) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async lockAnimal(
    tx: Prisma.TransactionClient,
    animalId: string,
    farmIds: string[],
  ): Promise<AnimalTargetInfo | null> {
    await lockRow(tx, 'Animal', animalId, farmIds);
    const animal = await tx.animal.findFirst({
      where: { id: animalId, farmId: { in: farmIds } },
      select: {
        id: true,
        farmId: true,
        tag: true,
        buildingId: true,
        birthDate: true,
        status: true,
      },
    });
    if (!animal) return null;
    return {
      id: animal.id,
      farmId: animal.farmId,
      label: animal.tag,
      species: 'PORCIN',
      buildingId: animal.buildingId,
      birthDate: animal.birthDate,
      active: LIVE_STATUSES.includes(animal.status),
    };
  }
}
