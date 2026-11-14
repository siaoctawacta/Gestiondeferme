import { Injectable, NotFoundException } from '@nestjs/common';
import type { RequestContext } from '../access/decorators';
import { AuditService } from '../audit/audit.service';
import type { Breed, Prisma } from '../generated/prisma/client';
import type { AuditAction, Species } from '../generated/prisma/enums';
import { orConflict } from '../listing/list-helpers';
import { PrismaService } from '../prisma/prisma.service';
import { auditHerd } from './herd-audit';
import type { CreateBreedDto, UpdateBreedDto } from './dto/breed.dto';

export interface BreedItem {
  id: string;
  name: string;
  species: Species;
}

const BREED_TAKEN = 'Cette souche existe déjà';

const toItem = (b: Breed): BreedItem => ({
  id: b.id,
  name: b.name,
  species: b.species,
});

@Injectable()
export class BreedsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(ctx: RequestContext, species?: Species): Promise<BreedItem[]> {
    const breeds = await this.prisma.breed.findMany({
      where: { organizationId: ctx.user.organizationId, species },
      orderBy: [{ species: 'asc' }, { name: 'asc' }],
    });
    return breeds.map(toItem);
  }

  async create(ctx: RequestContext, dto: CreateBreedDto): Promise<BreedItem> {
    return orConflict(
      () =>
        this.prisma.$transaction(async (tx) => {
          const created = await tx.breed.create({
            data: { ...dto, organizationId: ctx.user.organizationId },
          });
          await this.auditBreed(tx, ctx, 'CREATE', created, undefined, created);
          return toItem(created);
        }),
      BREED_TAKEN,
    );
  }

  async update(
    ctx: RequestContext,
    id: string,
    dto: UpdateBreedDto,
  ): Promise<BreedItem> {
    const before = await this.load(ctx, id);
    return orConflict(
      () =>
        this.prisma.$transaction(async (tx) => {
          const updated = await tx.breed.update({ where: { id }, data: dto });
          await this.auditBreed(tx, ctx, 'UPDATE', updated, before, updated);
          return toItem(updated);
        }),
      BREED_TAKEN,
    );
  }

  async remove(ctx: RequestContext, id: string): Promise<void> {
    const before = await this.load(ctx, id);
    await orConflict(() =>
      this.prisma.$transaction(async (tx) => {
        await tx.breed.delete({ where: { id } });
        await this.auditBreed(tx, ctx, 'DELETE', before, before);
      }),
    );
  }

  /** Audited in the module of the breed's species (`lots` or `porcs`), in the writing transaction. */
  private auditBreed(
    tx: Prisma.TransactionClient,
    ctx: RequestContext,
    action: AuditAction,
    breed: Breed,
    before?: Breed,
    after?: Breed,
  ): Promise<void> {
    return auditHerd(
      this.audit,
      tx,
      ctx,
      breed.species,
      action,
      breed.id,
      breed.name,
      before,
      after,
    );
  }

  private async load(ctx: RequestContext, id: string): Promise<Breed> {
    const breed = await this.prisma.breed.findFirst({
      where: { id, organizationId: ctx.user.organizationId },
    });
    if (!breed) throw new NotFoundException('Souche introuvable');
    return breed;
  }
}
