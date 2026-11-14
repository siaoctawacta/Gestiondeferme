import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { AccessClaims } from './access-token';
import type { RequestContext } from './decorators';
import { ALL_FARMS_ROLES } from './roles';

@Injectable()
export class AccessService {
  constructor(private readonly prisma: PrismaService) {}

  /** Loads the user fresh from the DB: role and active flag come from the row, not the token. */
  async loadUser(claims: AccessClaims): Promise<RequestContext['user']> {
    const user = await this.prisma.user.findUnique({
      where: { id: claims.sub },
    });
    if (!user || !user.active || user.organizationId !== claims.org) {
      throw new UnauthorizedException('Utilisateur introuvable ou désactivé');
    }
    return {
      id: user.id,
      name: user.name,
      role: user.role,
      organizationId: user.organizationId,
    };
  }

  /**
   * Resolves the `X-Farm-Id` header against the user's visible farms.
   * `isRead` tells whether the route only reads (required for `all`).
   */
  async resolveFarms(
    user: RequestContext['user'],
    header: string | undefined,
    isRead: boolean,
  ): Promise<Pick<RequestContext, 'farmId' | 'allFarms' | 'farmIds'>> {
    if (!header) {
      throw new BadRequestException('En-tête X-Farm-Id manquant');
    }
    const seesEveryFarm = ALL_FARMS_ROLES.includes(user.role);

    if (header === 'all') {
      if (!seesEveryFarm || !isRead) {
        throw new ForbiddenException('Accès à toutes les fermes refusé');
      }
      const farms = await this.prisma.farm.findMany({
        where: { organizationId: user.organizationId },
        select: { id: true },
      });
      return { farmId: null, allFarms: true, farmIds: farms.map((f) => f.id) };
    }

    const farm = await this.prisma.farm.findFirst({
      where: {
        id: header,
        organizationId: user.organizationId,
        ...(seesEveryFarm ? {} : { userFarms: { some: { userId: user.id } } }),
      },
      select: { id: true },
    });
    if (!farm) throw new ForbiddenException('Ferme non autorisée');
    return { farmId: farm.id, allFarms: false, farmIds: [farm.id] };
  }
}
