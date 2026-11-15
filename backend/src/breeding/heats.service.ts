import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { RequestContext } from '../access/decorators';
import { AuditService } from '../audit/audit.service';
import type { Heat } from '../generated/prisma/client';
import { assertNotFuture, formatDay, requireDay } from '../common/days';
import { lockRow } from '../common/lock-row';
import { EXITED } from '../common/messages';
import type { ListQueryDto } from '../listing/list-query.dto';
import { paginate } from '../listing/paginate';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateHeatDto, UpdateHeatDto } from './dto/breeding.dto';

export interface HeatItem {
  id: string;
  animalId: string;
  date: string;
  note: string | null;
}

const toItem = (h: Heat): HeatItem => ({
  id: h.id,
  animalId: h.animalId,
  date: formatDay(h.date),
  note: h.note,
});

@Injectable()
export class HeatsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async animal(
    ctx: RequestContext,
    id: string,
    client: Pick<PrismaService, 'animal'> = this.prisma,
  ) {
    const animal = await client.animal.findFirst({
      where: { id, farmId: { in: ctx.farmIds } },
    });
    if (!animal) throw new NotFoundException('Animal introuvable');
    return animal;
  }

  async list(ctx: RequestContext, animalId: string, q: ListQueryDto) {
    await this.animal(ctx, animalId);
    const where = { animalId, farmId: { in: ctx.farmIds } };
    return paginate(
      q,
      async (range) =>
        (
          await this.prisma.heat.findMany({
            where,
            orderBy: [{ date: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
            ...range,
          })
        ).map(toItem),
      () => this.prisma.heat.count({ where }),
    );
  }

  create(
    ctx: RequestContext,
    animalId: string,
    dto: CreateHeatDto,
  ): Promise<HeatItem> {
    return this.prisma.$transaction(async (tx) => {
      await lockRow(tx, 'Animal', animalId, ctx.farmIds);
      const animal = await this.animal(ctx, animalId, tx);
      if (animal.sex !== 'F') {
        throw new BadRequestException('Seules les femelles ont des chaleurs');
      }
      if (!['ACTIF', 'GESTANTE', 'ALLAITANTE'].includes(animal.status)) {
        throw new ConflictException(EXITED);
      }
      const date = requireDay(dto.date);
      assertNotFuture(date);
      if (animal.birthDate && date < animal.birthDate) {
        throw new BadRequestException(
          "La date est antérieure à la naissance de l'animal",
        );
      }
      const created = await tx.heat.create({
        data: { farmId: animal.farmId, animalId, date, note: dto.note },
      });
      const item = toItem(created);
      await this.log(
        tx,
        ctx,
        'CREATE',
        created.id,
        animal.tag,
        undefined,
        item,
      );
      return item;
    });
  }

  /** Corrects a heat of an animal still on the farm, within the same date rules as the creation. */
  update(
    ctx: RequestContext,
    animalId: string,
    heatId: string,
    dto: UpdateHeatDto,
  ): Promise<HeatItem> {
    return this.prisma.$transaction(async (tx) => {
      await lockRow(tx, 'Animal', animalId, ctx.farmIds);
      const animal = await this.animal(ctx, animalId, tx);
      if (!['ACTIF', 'GESTANTE', 'ALLAITANTE'].includes(animal.status)) {
        throw new ConflictException(EXITED);
      }
      const heat = await tx.heat.findFirst({
        where: { id: heatId, animalId, farmId: { in: ctx.farmIds } },
      });
      if (!heat) throw new NotFoundException('Chaleur introuvable');
      let date: Date | undefined;
      if (dto.date) {
        date = requireDay(dto.date);
        assertNotFuture(date);
        if (animal.birthDate && date < animal.birthDate) {
          throw new BadRequestException(
            "La date est antérieure à la naissance de l'animal",
          );
        }
      }
      const updated = await tx.heat.update({
        where: { id: heatId },
        data: { date, note: dto.note },
      });
      await this.log(
        tx,
        ctx,
        'UPDATE',
        heatId,
        animal.tag,
        toItem(heat),
        toItem(updated),
      );
      return toItem(updated);
    });
  }

  remove(ctx: RequestContext, animalId: string, heatId: string): Promise<void> {
    return this.prisma.$transaction(async (tx) => {
      await lockRow(tx, 'Animal', animalId, ctx.farmIds);
      const animal = await this.animal(ctx, animalId, tx);
      const heat = await tx.heat.findFirst({
        where: { id: heatId, animalId, farmId: { in: ctx.farmIds } },
      });
      if (!heat) throw new NotFoundException('Chaleur introuvable');
      await tx.heat.delete({ where: { id: heatId } });
      await this.log(tx, ctx, 'DELETE', heatId, animal.tag, toItem(heat));
    });
  }

  private log(
    tx: Parameters<AuditService['log']>[1],
    ctx: RequestContext,
    action: 'CREATE' | 'UPDATE' | 'DELETE',
    recordId: string,
    tag: string,
    before?: HeatItem,
    after?: HeatItem,
  ) {
    return this.audit.log(
      {
        ctx,
        module: 'reproduction',
        action,
        recordId,
        label: `${tag} · chaleur`,
        before,
        after,
      },
      tx,
    );
  }
}
