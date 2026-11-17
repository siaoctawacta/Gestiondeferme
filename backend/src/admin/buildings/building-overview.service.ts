import { Injectable } from '@nestjs/common';
import type { RequestContext } from '../../access/decorators';
import { can } from '../../access/permissions';
import { formatDayOrNull, today } from '../../common/days';
import { HerdLedgerService } from '../../herd/herd-ledger.service';
import {
  actInclude,
  LIVE_ANIMAL,
  toActItem,
} from '../../health/health-act-view';
import { OPEN_STATUSES } from '../../tasks/task-workflow';
import { PrismaService } from '../../prisma/prisma.service';
import {
  overviewAccess,
  type BuildingOverviewDto,
  type OverviewAccess,
} from './building-overview';
import { BuildingsService } from './buildings.service';

/** Acts listed on a building's page. */
export const OVERVIEW_ACTS = 5;

/**
 * The page a building's QR code opens: the building's own figures (`BuildingsService`, which owns
 * the 404 and the occupation) and what is in it. Every part is one query over the building, read
 * only when the role may read its module.
 */
@Injectable()
export class BuildingOverviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly buildings: BuildingsService,
    private readonly ledger: HerdLedgerService,
  ) {}

  async get(ctx: RequestContext, id: string): Promise<BuildingOverviewDto> {
    const building = await this.buildings.get(ctx, id);
    const access = overviewAccess((m) => can(ctx.user.role, m, 'read'));
    const [lots, animals, equipment, openTasks, lastHealthActs] =
      await Promise.all([
        this.lots(ctx, id, access),
        this.animals(ctx, id, access),
        this.equipment(ctx, id, access),
        this.openTasks(ctx, id, access),
        this.healthActs(ctx, id, access),
      ]);
    return {
      building: {
        id: building.id,
        name: building.name,
        type: building.type,
        status: building.status,
      },
      site: { id: building.siteId, name: building.siteName },
      occupation: building.occupation,
      capacity: building.capacity,
      lots,
      animals,
      equipment,
      openTasks,
      lastHealthActs,
    };
  }

  private async lots(
    ctx: RequestContext,
    id: string,
    access: OverviewAccess,
  ): Promise<BuildingOverviewDto['lots']> {
    if (access.species.length === 0) return null;
    const rows = await this.prisma.animalBatch.findMany({
      where: {
        buildingId: id,
        farmId: { in: ctx.farmIds },
        status: 'EN_COURS',
        species: { in: access.species },
      },
      select: { id: true, code: true, species: true },
      orderBy: [{ code: 'asc' }, { id: 'asc' }],
    });
    const alive = await this.ledger.liveCounts(rows.map((r) => r.id));
    return rows.map((r) => ({ ...r, alive: alive.get(r.id) ?? 0 }));
  }

  private async animals(
    ctx: RequestContext,
    id: string,
    access: OverviewAccess,
  ): Promise<number | null> {
    if (!access.animals) return null;
    return this.prisma.animal.count({
      where: {
        buildingId: id,
        farmId: { in: ctx.farmIds },
        status: { in: LIVE_ANIMAL },
      },
    });
  }

  private async equipment(
    ctx: RequestContext,
    id: string,
    access: OverviewAccess,
  ): Promise<BuildingOverviewDto['equipment']> {
    if (!access.equipment) return null;
    const rows = await this.prisma.equipment.findMany({
      where: { buildingId: id, farmId: { in: ctx.farmIds }, retiredAt: null },
      select: {
        id: true,
        name: true,
        condition: true,
        nextMaintenanceDate: true,
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      condition: r.condition,
      nextMaintenance: formatDayOrNull(r.nextMaintenanceDate),
    }));
  }

  private async openTasks(
    ctx: RequestContext,
    id: string,
    access: OverviewAccess,
  ): Promise<number | null> {
    if (!access.tasks) return null;
    return this.prisma.task.count({
      where: {
        buildingId: id,
        farmId: { in: ctx.farmIds },
        status: { in: OPEN_STATUSES },
      },
    });
  }

  /** Acts aimed at the building, at the lots of species the role reads housed in it, and (with `porcs`) at its animals. */
  private async healthActs(
    ctx: RequestContext,
    id: string,
    access: OverviewAccess,
  ): Promise<BuildingOverviewDto['lastHealthActs']> {
    if (!access.health) return null;
    const rows = await this.prisma.healthAct.findMany({
      where: {
        farmId: { in: ctx.farmIds },
        OR: [
          { buildingId: id },
          ...(access.species.length
            ? [{ batch: { buildingId: id, species: { in: access.species } } }]
            : []),
          ...(access.animals ? [{ animal: { buildingId: id } }] : []),
        ],
      },
      include: actInclude,
      relationLoadStrategy: 'join',
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
      take: OVERVIEW_ACTS,
    });
    const now = today();
    return rows
      .map((row) => toActItem(row, now))
      .map((a) => ({
        id: a.id,
        date: a.date,
        type: a.type,
        productName: a.productName,
        status: a.status,
      }));
  }
}
