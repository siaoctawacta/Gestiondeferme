import { BadRequestException, Injectable } from '@nestjs/common';
import type { RequestContext } from '../access/decorators';
import type {
  AnimalCategory,
  AnimalStatus,
  BatchType,
} from '../generated/prisma/enums';
import { addDays, formatDay } from '../common/days';
import { HerdLedgerService } from '../herd/herd-ledger.service';
import { openAtWhere } from '../herd/lot-open';
import type { ExportColumn } from '../listing/export';
import { PrismaService } from '../prisma/prisma.service';
import {
  ANIMAL_STATUSES,
  LIVE_STATUSES,
  latestWeights,
} from './animals.service';
import type { HerdListQueryDto } from './dto/animal.dto';

export type PigCategory =
  AnimalCategory | Extract<BatchType, 'PORCELET' | 'ENGRAISSEMENT'>;

const CATEGORY_LABEL: Record<PigCategory, string> = {
  TRUIE: 'Truie',
  VERRAT: 'Verrat',
  COCHETTE: 'Cochette',
  PORCELET: 'Porcelets',
  ENGRAISSEMENT: 'Engraissement',
};
/** Accepted `category` filter values: the enum names and the labels, any case. */
const CATEGORY_ALIASES = new Map<string, PigCategory>([
  ...(Object.entries(CATEGORY_LABEL) as [PigCategory, string][]).flatMap(
    ([key, label]): [string, PigCategory][] => [
      [key.toLowerCase(), key],
      [label.toLowerCase(), key],
    ],
  ),
]);

const STATUS_LABEL: Record<string, string> = {
  ACTIF: 'Actif',
  GESTANTE: 'Gestante',
  ALLAITANTE: 'Allaitante',
  VENDU: 'Vendu',
  MORT: 'Mort',
  REFORME: 'Réformé',
  EN_COURS: 'En cours',
  CLOTURE: 'Clôturé',
};
const FILTER_STATUSES = [...ANIMAL_STATUSES, 'EN_COURS', 'CLOTURE'];
const COUNT_KEYS = [
  'ACTIF',
  'GESTANTE',
  'ALLAITANTE',
  'VENDU',
  'MORT',
  'REFORME',
  'CLOTURE',
] as const;

/** Animals housed: 1 for an animal still on the farm. */
export const animalHeadcount = (status: AnimalStatus): number =>
  LIVE_STATUSES.includes(status) ? 1 : 0;

/** Animals housed: the live count for an open lot, else 0. */
export const lotHeadcount = (status: string, alive: number): number =>
  status === 'EN_COURS' ? alive : 0;

export interface HerdRow {
  kind: 'ANIMAL' | 'LOT';
  id: string;
  identifier: string;
  /** French label (Truie, Porcelets...). */
  category: string;
  /** TRUIE, VERRAT, COCHETTE, PORCELET or ENGRAISSEMENT. */
  categoryCode: PigCategory;
  breedName: string | null;
  buildingName: string;
  birthDate: string | null;
  entryDate: string | null;
  /** Latest weighing, kg. */
  weightKg: number | null;
  /** Animals housed: 1 for an animal still on the farm, the live count for an open lot, else 0. */
  headcount: number;
  /** Animal status, or `EN_COURS` / `CLOTURE` for a lot. */
  status: string;
}

interface Internal {
  key: PigCategory;
  row: HerdRow;
}

export const HERD_COLUMNS: ExportColumn<HerdRow>[] = [
  { header: 'Identifiant', value: (r) => r.identifier },
  { header: 'Catégorie', value: (r) => r.category },
  { header: 'Race', value: (r) => r.breedName },
  { header: 'Bâtiment', value: (r) => r.buildingName },
  {
    header: 'Date de naissance',
    date: true,
    value: (r) => r.birthDate ?? r.entryDate,
  },
  { header: 'Poids (kg)', value: (r) => r.weightKg },
  { header: 'Statut', value: (r) => STATUS_LABEL[r.status] ?? r.status },
];

/** Pig animals and pig lots in one list, as the reference "cheptel porcin" page shows them. */
@Injectable()
export class HerdListService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: HerdLedgerService,
  ) {}

  /**
   * Pigs housed in `farmIds` (the "cheptel porcin" total): the live animals plus
   * the live count of the pig lots. Without `at` it is today's headcount (open
   * lots only). With `at`, the headcount at the end of that day (`animalsHoused`
   * and the pig lots open that day at the count they had).
   */
  async totalPigs(farmIds: string[], at?: Date): Promise<number> {
    const farmId = { in: farmIds };
    const [animals, lots] = await Promise.all([
      this.animalsHoused(farmIds, at),
      this.prisma.animalBatch.findMany({
        where: {
          farmId,
          species: 'PORCIN',
          ...(at
            ? {
                entryDate: { lte: at },
                ...openAtWhere(at),
              }
            : { status: 'EN_COURS' }),
        },
        select: { id: true },
      }),
    ]);
    const alive = await this.ledger.liveCounts(
      lots.map((l) => l.id),
      at,
    );
    return animals + lots.reduce((n, l) => n + (alive.get(l.id) ?? 0), 0);
  }

  /**
   * Animals housed (`animalHeadcount`: still on the farm by status) on the
   * farms, today or at the end of `at`. For a past day an animal counts when
   * it had entered by then (its birth date, or, with none known, the day it
   * was registered: the model has no purchase date) and had not left yet
   * (`exitDate` after `at`; one with no exit date is judged by its status). Limit:
   * an animal bought after `at` whose birth date is known and earlier counts
   * from its birth.
   */
  private async animalsHoused(farmIds: string[], at?: Date): Promise<number> {
    const farmId = { in: farmIds };
    if (!at) {
      const groups = await this.prisma.animal.groupBy({
        by: ['status'],
        where: { farmId },
        _count: { _all: true },
      });
      return groups.reduce(
        (n, g) => n + animalHeadcount(g.status) * g._count._all,
        0,
      );
    }
    const entered = {
      farmId,
      OR: [
        { birthDate: { lte: at } },
        { birthDate: null, createdAt: { lt: addDays(at, 1) } },
      ],
    };
    const [stayed, left] = await Promise.all([
      this.prisma.animal.groupBy({
        by: ['status'],
        where: { ...entered, exitDate: null },
        _count: { _all: true },
      }),
      this.prisma.animal.count({
        where: { ...entered, exitDate: { gt: at } },
      }),
    ]);
    return (
      left +
      stayed.reduce((n, g) => n + animalHeadcount(g.status) * g._count._all, 0)
    );
  }

  /** The animals (not the lots) that left the herd between two days (both inclusive), by reason. One query. */
  async animalExits(
    farmIds: string[],
    from: Date,
    to: Date,
  ): Promise<{ dead: number; sold: number; culled: number }> {
    const groups = await this.prisma.animal.groupBy({
      by: ['exitReason'],
      where: { farmId: { in: farmIds }, exitDate: { gte: from, lte: to } },
      _count: { _all: true },
    });
    const count = (reason: 'MORT' | 'VENDU' | 'REFORME') =>
      groups.find((g) => g.exitReason === reason)?._count._all ?? 0;
    return {
      dead: count('MORT'),
      sold: count('VENDU'),
      culled: count('REFORME'),
    };
  }

  private async rows(ctx: RequestContext): Promise<Internal[]> {
    const farmId = { in: ctx.farmIds };
    const [animals, lots] = await Promise.all([
      this.prisma.animal.findMany({
        where: { farmId },
        include: {
          breed: { select: { name: true } },
          building: { select: { name: true } },
        },
      }),
      this.prisma.animalBatch.findMany({
        where: { farmId, species: 'PORCIN' },
        include: {
          breed: { select: { name: true } },
          building: { select: { name: true } },
        },
      }),
    ]);
    const lotIds = lots.map((l) => l.id);
    const [weights, alive, lotWeighings] = await Promise.all([
      latestWeights(
        this.prisma,
        animals.map((a) => a.id),
      ),
      this.ledger.liveCounts(lotIds),
      this.prisma.weighing.findMany({
        where: { batchId: { in: lotIds } },
        orderBy: [{ batchId: 'asc' }, { date: 'desc' }, { createdAt: 'desc' }],
        distinct: ['batchId'],
        select: { batchId: true, averageWeightG: true },
      }),
    ]);
    const lotWeight = new Map(
      lotWeighings.map((w) => [
        w.batchId,
        Math.round(w.averageWeightG / 100) / 10,
      ]),
    );
    const rows: Internal[] = [
      ...animals.map((a): Internal => ({
        key: a.category,
        row: {
          kind: 'ANIMAL',
          id: a.id,
          identifier: a.tag,
          category: CATEGORY_LABEL[a.category],
          categoryCode: a.category,
          breedName: a.breed?.name ?? null,
          buildingName: a.building.name,
          birthDate: a.birthDate ? formatDay(a.birthDate) : null,
          entryDate: null,
          weightKg: weights.get(a.id) ?? null,
          headcount: animalHeadcount(a.status),
          status: a.status,
        },
      })),
      ...lots.map((l): Internal => {
        const key = l.type === 'PORCELET' ? 'PORCELET' : 'ENGRAISSEMENT';
        return {
          key,
          row: {
            kind: 'LOT',
            id: l.id,
            identifier: l.code,
            category: CATEGORY_LABEL[key],
            categoryCode: key,
            breedName: l.breed?.name ?? null,
            buildingName: l.building.name,
            birthDate: null,
            entryDate: formatDay(l.entryDate),
            weightKg: lotWeight.get(l.id) ?? null,
            headcount: lotHeadcount(l.status, alive.get(l.id) ?? 0),
            status: l.status,
          },
        };
      }),
    ];
    return rows.sort(
      (a, b) =>
        (a.row.identifier < b.row.identifier
          ? -1
          : a.row.identifier > b.row.identifier
            ? 1
            : 0) || (a.row.id < b.row.id ? -1 : 1),
    );
  }

  private matchesStatus(row: HerdRow, status: string): boolean {
    if (status === 'ACTIF') {
      return row.kind === 'LOT'
        ? row.status === 'EN_COURS'
        : row.status === 'ACTIF';
    }
    return row.status === status;
  }

  /** `find` / `count` / `extra` for `sendList`, all sharing one read of the herd. */
  listArgs(ctx: RequestContext, q: HerdListQueryDto) {
    if (q.status && !FILTER_STATUSES.includes(q.status)) {
      throw new BadRequestException('Statut invalide');
    }
    let category: PigCategory | undefined;
    if (q.category) {
      category = CATEGORY_ALIASES.get(q.category.trim().toLowerCase());
      if (!category) throw new BadRequestException('Catégorie invalide');
    }
    const search = q.search?.trim().toLowerCase();
    let loaded: Promise<Internal[]> | undefined;
    const all = () => (loaded ??= this.rows(ctx));
    const filtered = async () =>
      (await all())
        .filter(
          (r) =>
            (!q.status || this.matchesStatus(r.row, q.status)) &&
            (!category || r.key === category) &&
            (!search || r.row.identifier.toLowerCase().includes(search)),
        )
        .map((r) => r.row);
    return {
      find: async (range: { skip?: number; take: number }) =>
        (await filtered()).slice(
          range.skip ?? 0,
          (range.skip ?? 0) + range.take,
        ),
      count: async () => (await filtered()).length,
      extra: async () => {
        const rows = (await all()).map((r) => r.row);
        const statusCounts = Object.fromEntries(
          COUNT_KEYS.map((k) => [k, 0]),
        ) as Record<(typeof COUNT_KEYS)[number], number>;
        for (const r of rows) {
          const k = r.status === 'EN_COURS' ? 'ACTIF' : r.status;
          statusCounts[k as keyof typeof statusCounts] += 1;
        }
        return {
          statusCounts,
          totalPigs: rows.reduce((sum, r) => sum + r.headcount, 0),
        };
      },
    };
  }
}
