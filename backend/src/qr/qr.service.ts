import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import QRCode from 'qrcode';
import type { RequestContext } from '../access/decorators';
import { AccessService } from '../access/access.service';
import { can } from '../access/permissions';
import { appUrl } from '../configure-app';
import { PrismaService } from '../prisma/prisma.service';
import type { QrTargetDto } from './dto/qr.dto';
import {
  isQrKind,
  qrLabels,
  qrModule,
  qrPath,
  type QrFacts,
  type QrKind,
} from './qr-targets';

/** One message for a record that does not exist, is another organisation's or farm's, is out of the role's reach or is retired. */
export const QR_UNKNOWN = 'QR code inconnu ou inaccessible';

interface Found {
  facts: QrFacts;
  farm: { id: string; name: string } | null;
}

/**
 * Resolves what a QR label points to. Whether a record exists, belongs to the caller's farms and
 * organisation and is readable by his role is ONE answer (`QR_UNKNOWN`): the record is always looked
 * up first, and every failure afterwards is the same 404, so the response never tells them apart.
 */
@Injectable()
export class QrService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
  ) {}

  async resolve(
    ctx: RequestContext,
    kind: string,
    id: string,
  ): Promise<QrTargetDto> {
    if (!isQrKind(kind)) throw new NotFoundException(QR_UNKNOWN);
    const [found] = await this.accessible(ctx, kind, [id]);
    if (!found) throw new NotFoundException(QR_UNKNOWN);
    return this.target(found);
  }

  /** Every label, in the order of `ids`; one inaccessible id refuses them all. */
  async labels(
    ctx: RequestContext,
    kind: QrKind,
    ids: string[],
  ): Promise<QrTargetDto[]> {
    const found = new Map(
      (await this.accessible(ctx, kind, ids)).map((f) => [f.facts.id, f]),
    );
    const ordered = ids.map((id) => found.get(id));
    if (ordered.some((f) => f === undefined)) {
      throw new BadRequestException(QR_UNKNOWN);
    }
    return Promise.all(ordered.map((f) => this.target(f as Found)));
  }

  private async target({ facts, farm }: Found): Promise<QrTargetDto> {
    const url = `${appUrl()}/q/${facts.kind}/${encodeURIComponent(facts.id)}`;
    return {
      kind: facts.kind,
      id: facts.id,
      farmId: farm?.id ?? null,
      farmName: farm?.name ?? null,
      path: qrPath(facts),
      url,
      ...qrLabels(facts),
      svg: await QRCode.toString(url, {
        type: 'svg',
        errorCorrectionLevel: 'M',
        margin: 1,
      }),
    };
  }

  /** The records among `ids` that exist for the caller AND whose module his role reads. */
  private async accessible(
    ctx: RequestContext,
    kind: QrKind,
    ids: string[],
  ): Promise<Found[]> {
    const found = await this.load(ctx, kind, ids);
    return found.filter((f) => can(ctx.user.role, qrModule(f.facts), 'read'));
  }

  /** One query: the records of the organisation, on a farm the user may see. */
  private async load(
    ctx: RequestContext,
    kind: QrKind,
    ids: string[],
  ): Promise<Found[]> {
    const farm = this.access.visibleFarmsWhere(ctx.user);
    const farmName = { select: { id: true, name: true } } as const;
    switch (kind) {
      case 'lot': {
        const rows = await this.prisma.animalBatch.findMany({
          where: { id: { in: ids }, farm },
          select: {
            id: true,
            code: true,
            species: true,
            type: true,
            building: { select: { name: true } },
            farm: farmName,
          },
          relationLoadStrategy: 'join',
        });
        return rows.map((r) => ({
          facts: {
            kind,
            id: r.id,
            code: r.code,
            species: r.species,
            type: r.type,
            buildingName: r.building.name,
          },
          farm: r.farm,
        }));
      }
      case 'animal': {
        const rows = await this.prisma.animal.findMany({
          where: { id: { in: ids }, farm },
          select: {
            id: true,
            tag: true,
            category: true,
            breed: { select: { name: true } },
            farm: farmName,
          },
          relationLoadStrategy: 'join',
        });
        return rows.map((r) => ({
          facts: {
            kind,
            id: r.id,
            tag: r.tag,
            category: r.category,
            breedName: r.breed?.name ?? null,
          },
          farm: r.farm,
        }));
      }
      case 'batiment': {
        const rows = await this.prisma.building.findMany({
          where: { id: { in: ids }, farm },
          select: {
            id: true,
            name: true,
            type: true,
            site: { select: { name: true } },
            farm: farmName,
          },
          relationLoadStrategy: 'join',
        });
        return rows.map((r) => ({
          facts: {
            kind,
            id: r.id,
            name: r.name,
            type: r.type,
            siteName: r.site.name,
          },
          farm: r.farm,
        }));
      }
      case 'article': {
        const rows = await this.prisma.stockItem.findMany({
          where: { id: { in: ids }, organizationId: ctx.user.organizationId },
          select: { id: true, name: true, category: true, unit: true },
        });
        return rows.map((r) => ({
          facts: {
            kind,
            id: r.id,
            name: r.name,
            category: r.category,
            unit: r.unit,
          },
          farm: null,
        }));
      }
      case 'equipement': {
        const rows = await this.prisma.equipment.findMany({
          where: { id: { in: ids }, retiredAt: null, farm },
          select: {
            id: true,
            name: true,
            type: true,
            building: { select: { name: true } },
            site: { select: { name: true } },
            farm: farmName,
          },
          relationLoadStrategy: 'join',
        });
        return rows.map((r) => ({
          facts: {
            kind,
            id: r.id,
            name: r.name,
            type: r.type,
            location: r.building?.name ?? r.site?.name ?? null,
          },
          farm: r.farm,
        }));
      }
    }
  }
}
