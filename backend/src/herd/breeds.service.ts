import { Injectable, NotFoundException } from '@nestjs/common';
import type { RequestContext } from '../access/decorators';
import type { AuditableService } from '../audit/audited.decorator';
import type { Breed } from '../generated/prisma/client';
import type { Species } from '../generated/prisma/enums';
import { orConflict } from '../listing/list-helpers';
import { PrismaService } from '../prisma/prisma.service';
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
export class BreedsService implements AuditableService {
  constructor(private readonly prisma: PrismaService) {}

  async list(ctx: RequestContext, species?: Species): Promise<BreedItem[]> {
    const breeds = await this.prisma.breed.findMany({
      where: { organizationId: ctx.user.organizationId, species },
      orderBy: [{ species: 'asc' }, { name: 'asc' }],
    });
    return breeds.map(toItem);
  }

  async create(ctx: RequestContext, dto: CreateBreedDto): Promise<BreedItem> {
    const created = await orConflict(
      () =>
        this.prisma.breed.create({
          data: { ...dto, organizationId: ctx.user.organizationId },
        }),
      BREED_TAKEN,
    );
    return toItem(created);
  }

  async update(
    ctx: RequestContext,
    id: string,
    dto: UpdateBreedDto,
  ): Promise<BreedItem> {
    await this.load(ctx, id);
    const updated = await orConflict(
      () => this.prisma.breed.update({ where: { id }, data: dto }),
      BREED_TAKEN,
    );
    return toItem(updated);
  }

  async remove(ctx: RequestContext, id: string): Promise<void> {
    await this.load(ctx, id);
    await orConflict(() => this.prisma.breed.delete({ where: { id } }));
  }

  findForAudit(id: string, ctx: RequestContext) {
    return this.prisma.breed.findFirst({
      where: { id, organizationId: ctx.user.organizationId },
    });
  }

  private async load(ctx: RequestContext, id: string): Promise<Breed> {
    const breed = await this.findForAudit(id, ctx);
    if (!breed) throw new NotFoundException('Souche introuvable');
    return breed;
  }
}
