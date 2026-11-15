import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { RequestContext } from '../../access/decorators';
import type { AuditableService } from '../../audit/audited.decorator';
import type { Prisma } from '../../generated/prisma/client';
import { BuildingStatus, BuildingType } from '../../generated/prisma/enums';
import type { ExportColumn } from '../../listing/export';
import { ListQueryDto, orderBy } from '../../listing/list-query.dto';
import { HerdLedgerService } from '../../herd/herd-ledger.service';
import { OccupationRegistry } from '../../herd/occupation';
import { occupationRate } from '../../indicators/indicators';
import { PrismaService } from '../../prisma/prisma.service';
import { containsInsensitive, orConflict } from '../../listing/list-helpers';
import type { CreateBuildingDto, UpdateBuildingDto } from './buildings.dto';

const include = {
  site: { select: { name: true } },
  _count: { select: { zones: true } },
} satisfies Prisma.BuildingInclude;

type BuildingRow = Prisma.BuildingGetPayload<{ include: typeof include }>;

export interface BuildingItem {
  id: string;
  name: string;
  type: BuildingType;
  siteId: string;
  siteName: string;
  capacity: number;
  occupation: number;
  occupationRate: number;
  status: BuildingStatus;
  zones: number;
}

const TYPE_LABEL: Record<BuildingType, string> = {
  AVICOLE: 'Avicole',
  PORCIN: 'Porcin',
  AUTRE: 'Autre',
};
const STATUS_LABEL: Record<BuildingStatus, string> = {
  ACTIF: 'Actif',
  VIDE_SANITAIRE: 'Vide sanitaire',
  MAINTENANCE: 'Maintenance',
};

export const BUILDING_COLUMNS: ExportColumn<BuildingItem>[] = [
  { header: 'Nom', value: (b) => b.name },
  { header: 'Type', value: (b) => TYPE_LABEL[b.type] },
  { header: 'Site', value: (b) => b.siteName },
  { header: 'Capacité', value: (b) => b.capacity },
  { header: 'Occupation', value: (b) => b.occupation },
  { header: 'Statut', value: (b) => STATUS_LABEL[b.status] },
  { header: 'Taux occ.', value: (b) => b.occupationRate },
];

const TYPE_LOCKED = 'Ce bâtiment est occupé : son type ne peut pas changer';
const SORTABLE = ['name', 'type', 'capacity', 'status', 'createdAt'];

@Injectable()
export class BuildingsService implements AuditableService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly occupation: OccupationRegistry,
    private readonly ledger: HerdLedgerService,
  ) {}

  /** Animals currently housed per building, summed over every registered source (lots, individual animals). */
  occupationOf(
    farmIds: string[],
    buildingIds: string[],
  ): Promise<Map<string, number>> {
    return this.occupation.occupationByBuilding(farmIds, buildingIds);
  }

  private scope(ctx: RequestContext): Prisma.BuildingWhereInput {
    return { farmId: { in: ctx.farmIds } };
  }

  private async toItems(rows: BuildingRow[]): Promise<BuildingItem[]> {
    const occupation = await this.occupationOf(
      [...new Set(rows.map((r) => r.farmId))],
      rows.map((r) => r.id),
    );
    return rows.map((r) => {
      const occ = occupation.get(r.id) ?? 0;
      return {
        id: r.id,
        name: r.name,
        type: r.type,
        siteId: r.siteId,
        siteName: r.site.name,
        capacity: r.capacity,
        occupation: occ,
        occupationRate: occupationRate(occ, r.capacity) ?? 0,
        status: r.status,
        zones: r._count.zones,
      };
    });
  }

  listArgs(ctx: RequestContext, q: ListQueryDto) {
    if (q.status && !Object.hasOwn(STATUS_LABEL, q.status)) {
      throw new BadRequestException('Statut de bâtiment invalide');
    }
    const where: Prisma.BuildingWhereInput = {
      AND: [
        this.scope(ctx),
        q.search ? { name: containsInsensitive(q.search) } : {},
        q.status ? { status: q.status as BuildingStatus } : {},
      ],
    };
    const order = orderBy(q, SORTABLE, { name: 'asc' });
    return {
      find: async (range: { skip?: number; take: number }) =>
        this.toItems(
          await this.prisma.building.findMany({
            where,
            include,
            orderBy: [order, { id: 'asc' }],
            ...range,
          }),
        ),
      count: () => this.prisma.building.count({ where }),
    };
  }

  /** Per-status totals over the whole scope, whatever the search, status or page. */
  async statusCounts(
    ctx: RequestContext,
  ): Promise<Record<BuildingStatus, number>> {
    const groups = await this.prisma.building.groupBy({
      by: ['status'],
      where: this.scope(ctx),
      _count: { _all: true },
    });
    const counts = Object.fromEntries(
      Object.keys(STATUS_LABEL).map((s) => [s, 0]),
    ) as Record<BuildingStatus, number>;
    for (const g of groups) counts[g.status] = g._count._all;
    return counts;
  }

  findForAudit(id: string, ctx: RequestContext) {
    return this.prisma.building.findFirst({
      where: { id, ...this.scope(ctx) },
    });
  }

  private async load(id: string, ctx: RequestContext): Promise<BuildingRow> {
    const building = await this.prisma.building.findFirst({
      where: { id, ...this.scope(ctx) },
      include,
    });
    if (!building) throw new NotFoundException('Bâtiment introuvable');
    return building;
  }

  async get(ctx: RequestContext, id: string): Promise<BuildingItem> {
    return (await this.toItems([await this.load(id, ctx)]))[0];
  }

  private async assertSiteInFarm(
    siteId: string,
    farmId: string,
  ): Promise<void> {
    const site = await this.prisma.site.findFirst({
      where: { id: siteId, farmId },
      select: { id: true },
    });
    if (!site) throw new BadRequestException('Site invalide pour cette ferme');
  }

  async create(
    ctx: RequestContext,
    dto: CreateBuildingDto,
  ): Promise<BuildingItem> {
    await this.assertSiteInFarm(dto.siteId, ctx.farmId!);
    const created = await orConflict(() =>
      this.prisma.building.create({
        data: { ...dto, farmId: ctx.farmId! },
        include,
      }),
    );
    return (await this.toItems([created]))[0];
  }

  async update(
    ctx: RequestContext,
    id: string,
    dto: UpdateBuildingDto,
  ): Promise<BuildingItem> {
    const current = await this.load(id, ctx);
    if (dto.siteId) await this.assertSiteInFarm(dto.siteId, ctx.farmId!);
    const updated = await orConflict(() =>
      this.prisma.$transaction(async (tx) => {
        const typeChanged = dto.type !== undefined && dto.type !== current.type;
        if (dto.capacity !== undefined || typeChanged) {
          // Same lock the herd ledger takes before its capacity check, so a
          // concurrent lot creation or transfer cannot slip past the new floor
          // (or into a building whose type is changing).
          await this.ledger.lockBuilding(tx, id);
        }
        if (typeChanged && (await this.houses(tx, current))) {
          throw new ConflictException(TYPE_LOCKED);
        }
        if (dto.capacity !== undefined) {
          const occupied =
            (
              await this.occupation.occupationByBuilding(
                [current.farmId],
                [id],
                tx,
              )
            ).get(id) ?? 0;
          if (dto.capacity < occupied) {
            throw new BadRequestException(
              `La capacité ne peut pas être inférieure à l'occupation actuelle (${occupied})`,
            );
          }
        }
        return tx.building.update({ where: { id }, data: dto, include });
      }),
    );
    return (await this.toItems([updated]))[0];
  }

  /**
   * Whether lots or animals are housed here: current occupation (every source),
   * or an open lot even when it has lost all its animals, which still belongs
   * to the building's species until it is closed.
   */
  private async houses(tx: Prisma.TransactionClient, building: BuildingRow) {
    const occupied =
      (
        await this.occupation.occupationByBuilding(
          [building.farmId],
          [building.id],
          tx,
        )
      ).get(building.id) ?? 0;
    if (occupied > 0) return true;
    return (
      (await tx.animalBatch.count({
        where: { buildingId: building.id, status: 'EN_COURS' },
      })) > 0
    );
  }

  async remove(ctx: RequestContext, id: string): Promise<void> {
    const building = await this.load(id, ctx);
    const message = 'Ce bâtiment est occupé ou a un historique';
    const occupied = (
      await this.occupationOf([building.farmId], [building.id])
    ).get(building.id);
    const batches = await this.prisma.animalBatch.count({
      where: { buildingId: building.id },
    });
    if ((occupied ?? 0) > 0 || batches > 0) {
      throw new ConflictException(message);
    }
    try {
      await this.prisma.$transaction([
        this.prisma.zone.deleteMany({ where: { buildingId: building.id } }),
        this.prisma.building.delete({ where: { id } }),
      ]);
    } catch (error) {
      // A lot or animal was housed here between the check and the delete.
      if ((error as { code?: string } | null)?.code === 'P2003') {
        throw new ConflictException(message);
      }
      throw error;
    }
  }
}
