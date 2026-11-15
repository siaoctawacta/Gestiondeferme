import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { RequestContext } from '../access/decorators';
import { AuditService } from '../audit/audit.service';
import type { Prisma } from '../generated/prisma/client';
import type {
  AnimalCategory,
  AnimalSex,
  AnimalStatus,
} from '../generated/prisma/enums';
import { assertNotFuture, formatDay, requireDay } from '../common/days';
import { lockRow } from '../common/lock-row';
import { EXITED } from '../common/messages';
import {
  breedingInclude,
  type BreedingRow,
  toBreedingItem,
} from '../breeding/breeding-item';
import { HerdLedgerService } from '../herd/herd-ledger.service';
import { assertBuildingFits } from '../herd/species';
import { OccupationRegistry, OccupationSource } from '../herd/occupation';
import { containsInsensitive, orConflict } from '../listing/list-helpers';
import { ListQueryDto, orderBy } from '../listing/list-query.dto';
import { paginate } from '../listing/paginate';
import { PrismaService } from '../prisma/prisma.service';
import { nextAnimalTag } from './animal-tag';
import type {
  AnimalListQueryDto,
  CreateAnimalDto,
  CreateAnimalWeighingDto,
  ExitAnimalDto,
  UpdateAnimalDto,
  UpdateAnimalWeighingDto,
} from './dto/animal.dto';

type Tx = Prisma.TransactionClient;

export const NOT_FOUND = 'Animal introuvable';
export const PREGNANT_OR_NURSING = 'Cette truie est gestante ou allaitante';
const BEFORE_BIRTH = "La date est antérieure à la naissance de l'animal";
const HISTORY = 'Cet animal a un historique ; déclarez sa sortie plutôt';
const NOT_EXITED = "Cet animal n'est pas sorti du cheptel";
const RECORDED_AFTER_EXIT =
  'Des données ont été enregistrées après la sortie de cet animal';

/** Statuses of an animal that is still on the farm (and so housed in its building). */
export const LIVE_STATUSES: AnimalStatus[] = [
  'ACTIF',
  'GESTANTE',
  'ALLAITANTE',
];
export const ANIMAL_STATUSES: AnimalStatus[] = [
  ...LIVE_STATUSES,
  'VENDU',
  'MORT',
  'REFORME',
];
export const SEX_OF: Record<AnimalCategory, AnimalSex> = {
  TRUIE: 'F',
  VERRAT: 'M',
  COCHETTE: 'F',
};

const include = {
  breed: { select: { name: true } },
  building: { select: { name: true } },
} satisfies Prisma.AnimalInclude;
type Row = Prisma.AnimalGetPayload<{ include: typeof include }>;

export interface AnimalItem {
  id: string;
  tag: string;
  category: AnimalCategory;
  sex: AnimalSex;
  breedId: string | null;
  breedName: string | null;
  buildingId: string;
  buildingName: string;
  birthDate: string | null;
  sireId: string | null;
  sireTag: string | null;
  damId: string | null;
  damTag: string | null;
  status: AnimalStatus;
  /** Latest weighing, kg. */
  weightKg: number | null;
  exitDate: string | null;
  exitReason: string | null;
  notes: string | null;
}

export interface AnimalWeighingItem {
  id: string;
  animalId: string;
  date: string;
  weightKg: number;
}

const SORTABLE = ['tag', 'birthDate', 'status', 'createdAt'];

const toWeighingItem = (w: {
  id: string;
  animalId: string;
  date: Date;
  weightKg: Prisma.Decimal;
}): AnimalWeighingItem => ({
  id: w.id,
  animalId: w.animalId,
  date: formatDay(w.date),
  weightKg: w.weightKg.toNumber(),
});

/** Latest weight (kg) per animal. */
export async function latestWeights(
  client: Tx | PrismaService,
  animalIds: string[],
): Promise<Map<string, number>> {
  if (animalIds.length === 0) return new Map();
  const rows = await client.animalWeighing.findMany({
    where: { animalId: { in: animalIds } },
    orderBy: [{ animalId: 'asc' }, { date: 'desc' }, { createdAt: 'desc' }],
    distinct: ['animalId'],
    select: { animalId: true, weightKg: true },
  });
  return new Map(rows.map((r) => [r.animalId, r.weightKg.toNumber()]));
}

@Injectable()
export class AnimalsService implements OccupationSource {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: HerdLedgerService,
    private readonly audit: AuditService,
    registry: OccupationRegistry,
  ) {
    registry.register(this);
  }

  /** Animals still on the farm, per building. */
  async occupationByBuilding(
    farmIds: string[],
    buildingIds: string[],
    tx?: Tx,
  ): Promise<Map<string, number>> {
    const result = new Map(buildingIds.map((id) => [id, 0]));
    if (buildingIds.length === 0) return result;
    const groups = await (tx ?? this.prisma).animal.groupBy({
      by: ['buildingId'],
      where: {
        farmId: { in: farmIds },
        buildingId: { in: buildingIds },
        status: { in: LIVE_STATUSES },
      },
      _count: { _all: true },
    });
    for (const g of groups) result.set(g.buildingId, g._count._all);
    return result;
  }

  async toItems(rows: Row[], client: Tx | PrismaService = this.prisma) {
    // Sequential reads: a transaction owns one connection, and four parallel
    // relation loads on one query make the driver warn.
    const weights = await latestWeights(
      client,
      rows.map((r) => r.id),
    );
    const parentIds = [
      ...new Set(
        rows.flatMap((r) => [r.sireId, r.damId]).filter((p) => p !== null),
      ),
    ];
    const parents = new Map(
      (parentIds.length === 0
        ? []
        : await client.animal.findMany({
            where: { id: { in: parentIds } },
            select: { id: true, tag: true },
          })
      ).map((p) => [p.id, p.tag]),
    );
    return rows.map((r): AnimalItem => ({
      id: r.id,
      tag: r.tag,
      category: r.category,
      sex: r.sex,
      breedId: r.breedId,
      breedName: r.breed?.name ?? null,
      buildingId: r.buildingId,
      buildingName: r.building.name,
      birthDate: r.birthDate ? formatDay(r.birthDate) : null,
      sireId: r.sireId,
      sireTag: (r.sireId && parents.get(r.sireId)) || null,
      damId: r.damId,
      damTag: (r.damId && parents.get(r.damId)) || null,
      status: r.status,
      weightKg: weights.get(r.id) ?? null,
      exitDate: r.exitDate ? formatDay(r.exitDate) : null,
      exitReason: r.exitReason,
      notes: r.notes,
    }));
  }

  listArgs(ctx: RequestContext, q: AnimalListQueryDto) {
    if (q.status && !ANIMAL_STATUSES.includes(q.status as AnimalStatus)) {
      throw new BadRequestException("Statut d'animal invalide");
    }
    const where: Prisma.AnimalWhereInput = {
      farmId: { in: ctx.farmIds },
      ...(q.status ? { status: q.status as AnimalStatus } : {}),
      ...(q.sex ? { sex: q.sex } : {}),
      ...(q.category ? { category: q.category } : {}),
      ...(q.search ? { tag: containsInsensitive(q.search) } : {}),
    };
    const order = orderBy(q, SORTABLE, { tag: 'asc' });
    return {
      find: async (range: { skip?: number; take: number }) =>
        this.toItems(
          await this.prisma.animal.findMany({
            where,
            include,
            orderBy: [order, { id: 'asc' }],
            ...range,
          }),
        ),
      count: () => this.prisma.animal.count({ where }),
    };
  }

  private async load(
    client: Tx | PrismaService,
    ctx: RequestContext,
    id: string,
  ): Promise<Row> {
    const row = await client.animal.findFirst({
      where: { id, farmId: { in: ctx.farmIds } },
      include,
    });
    if (!row) throw new NotFoundException(NOT_FOUND);
    return row;
  }

  async get(ctx: RequestContext, id: string): Promise<AnimalItem> {
    return (await this.toItems([await this.load(this.prisma, ctx, id)]))[0];
  }

  /** 404 when the animal is outside the caller's farms (reads). */
  async assertVisible(ctx: RequestContext, id: string): Promise<void> {
    await this.load(this.prisma, ctx, id);
  }

  /** Row lock serialising every change to one animal; 404 outside the caller's farms. */
  private async lock(tx: Tx, ctx: RequestContext, id: string): Promise<Row> {
    await lockRow(tx, 'Animal', id, ctx.farmIds);
    return this.load(tx, ctx, id);
  }

  /** The building is in the farm and takes pigs (a poultry house does not). */
  private async assertBuilding(tx: Tx, farmId: string, buildingId: string) {
    const building = await tx.building.findFirst({
      where: { id: buildingId, farmId },
      select: { id: true, type: true },
    });
    if (!building) {
      throw new BadRequestException('Bâtiment invalide pour cette ferme');
    }
    assertBuildingFits(building, 'PORCIN');
  }

  private async assertRefs(
    tx: Tx,
    ctx: RequestContext,
    farmId: string,
    refs: {
      selfId?: string;
      breedId?: string | null;
      sireId?: string | null;
      damId?: string | null;
    },
  ): Promise<void> {
    if (refs.breedId) {
      const breed = await tx.breed.findFirst({
        where: {
          id: refs.breedId,
          organizationId: ctx.user.organizationId,
          species: 'PORCIN',
        },
        select: { id: true },
      });
      if (!breed) throw new BadRequestException('Race invalide');
    }
    const parent = async (
      id: string | null | undefined,
      sex: AnimalSex,
      message: string,
    ) => {
      if (!id) return;
      if (id === refs.selfId) {
        throw new BadRequestException(
          'Un animal ne peut pas être son propre parent',
        );
      }
      const found = await tx.animal.findFirst({
        where: { id, farmId, sex },
        select: { id: true },
      });
      if (!found) throw new BadRequestException(message);
    };
    await parent(refs.sireId, 'M', 'Père invalide (un mâle de la ferme)');
    await parent(refs.damId, 'F', 'Mère invalide (une femelle de la ferme)');
  }

  private birth(value: string | null | undefined): Date | null | undefined {
    if (value === undefined || value === null) return value;
    const date = requireDay(value);
    assertNotFuture(date);
    return date;
  }

  create(ctx: RequestContext, dto: CreateAnimalDto): Promise<AnimalItem> {
    return this.prisma.$transaction(async (tx) => {
      const farmId = ctx.farmId;
      if (!farmId) throw new BadRequestException('Sélectionnez une ferme');
      const sex = SEX_OF[dto.category];
      if (dto.sex && dto.sex !== sex) {
        throw new BadRequestException(
          'Le sexe ne correspond pas à la catégorie',
        );
      }
      const birthDate = this.birth(dto.birthDate);
      await this.assertBuilding(tx, farmId, dto.buildingId);
      await this.assertRefs(tx, ctx, farmId, dto);
      const tag = dto.tag ?? (await nextAnimalTag(tx, farmId, dto.category));
      const created = await orConflict(
        () =>
          tx.animal.create({
            data: {
              farmId,
              tag,
              category: dto.category,
              sex,
              breedId: dto.breedId,
              buildingId: dto.buildingId,
              birthDate,
              sireId: dto.sireId,
              damId: dto.damId,
              notes: dto.notes,
            },
            include,
          }),
        'Ce numéro existe déjà',
      );
      await this.ledger.assertCapacity(tx, farmId, created.buildingId);
      const [item] = await this.toItems([created], tx);
      await this.log(tx, ctx, 'CREATE', item.id, item.tag, undefined, item);
      return item;
    });
  }

  update(
    ctx: RequestContext,
    id: string,
    dto: UpdateAnimalDto,
  ): Promise<AnimalItem> {
    return this.prisma.$transaction(async (tx) => {
      const row = await this.lock(tx, ctx, id);
      if (!LIVE_STATUSES.includes(row.status)) {
        throw new ConflictException(EXITED);
      }
      const [before] = await this.toItems([row], tx);
      const birthDate = this.birth(dto.birthDate);
      if (birthDate) await this.assertBornBeforeHistory(tx, row, birthDate);
      const moved =
        dto.buildingId !== undefined && dto.buildingId !== row.buildingId;
      if (moved) await this.assertBuilding(tx, row.farmId, dto.buildingId!);
      await this.assertRefs(tx, ctx, row.farmId, { selfId: id, ...dto });
      const updated = await orConflict(
        () =>
          tx.animal.update({
            where: { id },
            data: {
              tag: dto.tag,
              breedId: dto.breedId,
              buildingId: dto.buildingId,
              birthDate,
              sireId: dto.sireId,
              damId: dto.damId,
              notes: dto.notes,
            },
            include,
          }),
        'Ce numéro existe déjà',
      );
      if (moved)
        await this.ledger.assertCapacity(tx, row.farmId, updated.buildingId);
      const [after] = await this.toItems([updated], tx);
      await this.log(tx, ctx, 'UPDATE', id, after.tag, before, after);
      return after;
    });
  }

  /** 400 when the new birth date falls after a weighing, a heat, a breeding step or the exit of the animal. */
  private async assertBornBeforeHistory(
    tx: Tx,
    row: Row,
    birthDate: Date,
  ): Promise<void> {
    // One query at a time: the transaction owns a single connection.
    const weighing = await tx.animalWeighing.aggregate({
      where: { animalId: row.id },
      _min: { date: true },
    });
    const heat = await tx.heat.aggregate({
      where: { animalId: row.id },
      _min: { date: true },
    });
    const steps = await tx.breedingRecord.findMany({
      where: { OR: [{ sowId: row.id }, { boarId: row.id }] },
      select: {
        serviceDate: true,
        farrowingDate: true,
        weaningDate: true,
        failureDate: true,
      },
    });
    const breeding = steps
      .flatMap((b) => [
        b.serviceDate,
        b.farrowingDate,
        b.weaningDate,
        b.failureDate,
      ])
      .filter((d) => d !== null)
      .reduce<Date | null>((min, d) => (!min || d < min ? d : min), null);
    const checks: [string, Date | null][] = [
      ['à une pesée', weighing._min.date],
      ['à une chaleur', heat._min.date],
      ['à un événement de reproduction', breeding],
      ['à la date de sortie', row.exitDate],
    ];
    for (const [label, date] of checks) {
      if (date && date < birthDate) {
        throw new BadRequestException(
          `La date de naissance est postérieure ${label}`,
        );
      }
    }
  }

  async remove(ctx: RequestContext, id: string): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        const row = await this.lock(tx, ctx, id);
        // One query at a time: the transaction owns a single connection.
        const counts = [
          await tx.animalWeighing.count({ where: { animalId: id } }),
          await tx.heat.count({ where: { animalId: id } }),
          await tx.breedingRecord.count({ where: { sowId: id } }),
          await tx.breedingRecord.count({ where: { boarId: id } }),
          await tx.animal.count({
            where: { OR: [{ sireId: id }, { damId: id }] },
          }),
          await tx.animalBatch.count({ where: { motherAnimalId: id } }),
        ];
        if (counts.some((n) => n > 0)) {
          throw new ConflictException(HISTORY);
        }
        const [before] = await this.toItems([row], tx);
        await tx.animal.delete({ where: { id } });
        await this.log(tx, ctx, 'DELETE', id, row.tag, before);
      });
    } catch (error) {
      if ((error as { code?: string } | null)?.code === 'P2003') {
        throw new ConflictException(HISTORY);
      }
      throw error;
    }
  }

  /**
   * Sale, death or culling. A pregnant or nursing sow cannot be sold or
   * culled; a sow that dies during gestation fails her breeding record (each
   * one audited in `reproduction`). Lock order (sow, then her breeding
   * records) matches the breeding service.
   */
  exit(
    ctx: RequestContext,
    id: string,
    dto: ExitAnimalDto,
  ): Promise<AnimalItem> {
    return this.prisma.$transaction(async (tx) => {
      const row = await this.lock(tx, ctx, id);
      if (!LIVE_STATUSES.includes(row.status)) {
        throw new ConflictException(EXITED);
      }
      const date = requireDay(dto.date);
      assertNotFuture(date);
      if (row.birthDate && date < row.birthDate) {
        throw new BadRequestException(BEFORE_BIRTH);
      }
      await this.assertAfterLastRecord(tx, id, date);
      if (
        dto.reason !== 'MORT' &&
        (row.status === 'GESTANTE' || row.status === 'ALLAITANTE')
      ) {
        throw new ConflictException(PREGNANT_OR_NURSING);
      }
      const [before] = await this.toItems([row], tx);
      if (dto.reason === 'MORT') {
        const gestations = await tx.breedingRecord.findMany({
          where: { sowId: id, status: 'GESTATION' },
          select: { id: true },
          orderBy: { id: 'asc' },
        });
        for (const g of gestations) await lockRow(tx, 'BreedingRecord', g.id);
        for (const g of gestations) {
          const was = await tx.breedingRecord.findUniqueOrThrow({
            where: { id: g.id },
            include: breedingInclude,
          });
          const failed = await tx.breedingRecord.update({
            where: { id: g.id },
            data: { status: 'ECHEC', failureDate: date },
            include: breedingInclude,
          });
          await this.logBreeding(tx, ctx, was, failed);
        }
      }
      const updated = await tx.animal.update({
        where: { id },
        data: {
          status: dto.reason,
          exitDate: date,
          exitReason: dto.reason,
        },
        include,
      });
      const [after] = await this.toItems([updated], tx);
      await this.log(tx, ctx, 'UPDATE', id, after.tag, before, after);
      return after;
    });
  }

  /** The exit may not predate the animal's last breeding step, weighing or heat. */
  private async assertAfterLastRecord(
    tx: Tx,
    id: string,
    date: Date,
  ): Promise<void> {
    const events = await tx.breedingRecord.findMany({
      where: { sowId: id },
      select: {
        serviceDate: true,
        farrowingDate: true,
        weaningDate: true,
        failureDate: true,
      },
    });
    const last = events
      .flatMap((e) => [
        e.serviceDate,
        e.farrowingDate,
        e.weaningDate,
        e.failureDate,
      ])
      .filter((d) => d !== null)
      .reduce((max, d) => Math.max(max, d.getTime()), 0);
    if (date.getTime() < last) {
      throw new BadRequestException(
        'La date de sortie est antérieure au dernier événement de reproduction',
      );
    }
    const weighing = await tx.animalWeighing.aggregate({
      where: { animalId: id },
      _max: { date: true },
    });
    if (weighing._max.date && date < weighing._max.date) {
      throw new BadRequestException(
        'La date de sortie est antérieure à la dernière pesée',
      );
    }
    const heat = await tx.heat.aggregate({
      where: { animalId: id },
      _max: { date: true },
    });
    if (heat._max.date && date < heat._max.date) {
      throw new BadRequestException(
        'La date de sortie est antérieure à la dernière chaleur',
      );
    }
  }

  /**
   * Undoes a mistaken exit. Refused (409) when the animal is still on the farm
   * or when anything was recorded for it after the exit date. The status goes
   * back to ACTIF; a sow whose gestation that same exit failed (a death on the
   * exit date) gets that record back and is GESTANTE again, and a sow with a
   * litter still to wean is ALLAITANTE. The building's species fit and capacity
   * are checked again (it may have changed type, or filled up, meanwhile).
   */
  reinstate(ctx: RequestContext, id: string): Promise<AnimalItem> {
    return this.prisma.$transaction(async (tx) => {
      const row = await this.lock(tx, ctx, id);
      if (LIVE_STATUSES.includes(row.status))
        throw new ConflictException(NOT_EXITED);
      const exitDate = row.exitDate;
      if (exitDate && (await this.hasRecordAfter(tx, id, exitDate))) {
        throw new ConflictException(RECORDED_AFTER_EXIT);
      }
      // The building may have changed type since the animal left.
      await this.assertBuilding(tx, row.farmId, row.buildingId);
      const [before] = await this.toItems([row], tx);
      let status: AnimalStatus = 'ACTIF';
      if (row.sex === 'F') {
        const failed = exitDate
          ? await tx.breedingRecord.findFirst({
              where: {
                sowId: id,
                status: 'ECHEC',
                failureDate: exitDate,
                farrowingDate: null,
              },
              orderBy: [{ serviceDate: 'desc' }, { id: 'asc' }],
            })
          : null;
        if (failed) {
          await lockRow(tx, 'BreedingRecord', failed.id);
          const was = await tx.breedingRecord.findUniqueOrThrow({
            where: { id: failed.id },
            include: breedingInclude,
          });
          const restored = await tx.breedingRecord.update({
            where: { id: failed.id },
            data: { status: 'GESTATION', failureDate: null },
            include: breedingInclude,
          });
          await this.logBreeding(tx, ctx, was, restored);
          status = 'GESTANTE';
        } else if (
          await tx.breedingRecord.count({
            where: { sowId: id, status: 'MISE_BAS' },
          })
        ) {
          status = 'ALLAITANTE';
        }
      }
      const updated = await tx.animal.update({
        where: { id },
        data: { status, exitDate: null, exitReason: null },
        include,
      });
      await this.ledger.assertCapacity(tx, updated.farmId, updated.buildingId);
      const [after] = await this.toItems([updated], tx);
      await this.log(tx, ctx, 'UPDATE', id, after.tag, before, after);
      return after;
    });
  }

  /** Anything recorded for the animal strictly after `date`: weighing, heat, breeding step. */
  private async hasRecordAfter(
    tx: Tx,
    id: string,
    date: Date,
  ): Promise<boolean> {
    const later = { gt: date };
    const counts = [
      await tx.animalWeighing.count({ where: { animalId: id, date: later } }),
      await tx.heat.count({ where: { animalId: id, date: later } }),
      await tx.breedingRecord.count({
        where: {
          OR: [{ sowId: id }, { boarId: id }],
          AND: [
            {
              OR: [
                { serviceDate: later },
                { farrowingDate: later },
                { weaningDate: later },
                { failureDate: later },
              ],
            },
          ],
        },
      }),
    ];
    return counts.some((n) => n > 0);
  }

  /** Audits a breeding record changed as a side effect of an animal operation. */
  private logBreeding(
    tx: Tx,
    ctx: RequestContext,
    before: BreedingRow,
    after: BreedingRow,
  ) {
    return this.audit.log(
      {
        ctx,
        module: 'reproduction',
        action: 'UPDATE',
        recordId: after.id,
        label: after.sow.tag,
        before: toBreedingItem(before),
        after: toBreedingItem(after),
      },
      tx,
    );
  }

  async listWeighings(ctx: RequestContext, id: string, q: ListQueryDto) {
    await this.assertVisible(ctx, id);
    const where: Prisma.AnimalWeighingWhereInput = {
      animalId: id,
      farmId: { in: ctx.farmIds },
    };
    return paginate(
      q,
      async (range) =>
        (
          await this.prisma.animalWeighing.findMany({
            where,
            orderBy: [{ date: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
            ...range,
          })
        ).map(toWeighingItem),
      () => this.prisma.animalWeighing.count({ where }),
    );
  }

  createWeighing(
    ctx: RequestContext,
    id: string,
    dto: CreateAnimalWeighingDto,
  ): Promise<AnimalWeighingItem> {
    return this.prisma.$transaction(async (tx) => {
      const row = await this.lock(tx, ctx, id);
      if (!LIVE_STATUSES.includes(row.status)) {
        throw new ConflictException(EXITED);
      }
      const date = requireDay(dto.date);
      assertNotFuture(date);
      if (row.birthDate && date < row.birthDate) {
        throw new BadRequestException(BEFORE_BIRTH);
      }
      const created = await tx.animalWeighing.create({
        data: {
          farmId: row.farmId,
          animalId: id,
          date,
          weightKg: dto.weightKg,
        },
      });
      const item = toWeighingItem(created);
      await this.log(
        tx,
        ctx,
        'CREATE',
        created.id,
        `${row.tag} · pesée`,
        undefined,
        item,
      );
      return item;
    });
  }

  /** Weighing of an animal still on the farm, 404 when it is not this animal's. */
  private async liveWeighing(
    tx: Tx,
    ctx: RequestContext,
    id: string,
    weighingId: string,
  ) {
    const row = await this.lock(tx, ctx, id);
    if (!LIVE_STATUSES.includes(row.status)) {
      throw new ConflictException(EXITED);
    }
    const weighing = await tx.animalWeighing.findFirst({
      where: { id: weighingId, animalId: id, farmId: { in: ctx.farmIds } },
    });
    if (!weighing) throw new NotFoundException('Pesée introuvable');
    return { row, weighing };
  }

  updateWeighing(
    ctx: RequestContext,
    id: string,
    weighingId: string,
    dto: UpdateAnimalWeighingDto,
  ): Promise<AnimalWeighingItem> {
    return this.prisma.$transaction(async (tx) => {
      const { row, weighing } = await this.liveWeighing(
        tx,
        ctx,
        id,
        weighingId,
      );
      let date: Date | undefined;
      if (dto.date) {
        date = requireDay(dto.date);
        assertNotFuture(date);
        if (row.birthDate && date < row.birthDate) {
          throw new BadRequestException(BEFORE_BIRTH);
        }
      }
      const updated = await tx.animalWeighing.update({
        where: { id: weighingId },
        data: { date, weightKg: dto.weightKg },
      });
      const item = toWeighingItem(updated);
      await this.log(
        tx,
        ctx,
        'UPDATE',
        weighingId,
        `${row.tag} · pesée`,
        toWeighingItem(weighing),
        item,
      );
      return item;
    });
  }

  removeWeighing(
    ctx: RequestContext,
    id: string,
    weighingId: string,
  ): Promise<void> {
    return this.prisma.$transaction(async (tx) => {
      const { row, weighing } = await this.liveWeighing(
        tx,
        ctx,
        id,
        weighingId,
      );
      await tx.animalWeighing.delete({ where: { id: weighingId } });
      await this.log(
        tx,
        ctx,
        'DELETE',
        weighingId,
        `${row.tag} · pesée`,
        toWeighingItem(weighing),
      );
    });
  }

  private log(
    tx: Tx,
    ctx: RequestContext,
    action: 'CREATE' | 'UPDATE' | 'DELETE',
    recordId: string,
    label: string,
    before?: unknown,
    after?: unknown,
  ) {
    return this.audit.log(
      { ctx, module: 'porcs', action, recordId, label, before, after },
      tx,
    );
  }
}
