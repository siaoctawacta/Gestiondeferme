import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import type { RequestContext } from '../../access/decorators';
import { AuditService } from '../../audit/audit.service';
import type { AuditableService } from '../../audit/audited.decorator';
import { hashPassword } from '../../auth/password';
import { sha256, TokensService } from '../../auth/tokens.service';
import type { Prisma } from '../../generated/prisma/client';
import type { Role } from '../../generated/prisma/enums';
import type { ExportColumn } from '../../listing/export';
import { ListQueryDto, orderBy } from '../../listing/list-query.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { containsInsensitive, orConflict } from '../../listing/list-helpers';
import type { CreateUserDto, UpdateUserDto } from './users.dto';

const RESET_TTL_MS = 24 * 60 * 60 * 1000;
const LAST_ADMIN = 'Au moins un Super Administrateur actif est requis';

const include = {
  farms: { include: { farm: { select: { id: true, name: true } } } },
} satisfies Prisma.UserInclude;

type UserRow = Prisma.UserGetPayload<{ include: typeof include }>;

export interface UserView {
  id: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  farms: { id: string; name: string }[];
  twoFactorEnabled: boolean;
  lastLoginAt: Date | null;
}

const ROLE_LABEL: Record<Role, string> = {
  SUPER_ADMIN: 'Super administrateur',
  PROPRIETAIRE: 'Propriétaire',
  DIRECTEUR_FERME: 'Directeur de ferme',
  RESP_AVICOLE: 'Responsable avicole',
  RESP_PORCIN: 'Responsable porcin',
  VETERINAIRE: 'Vétérinaire',
  RESP_STOCK: 'Responsable stock',
  COMPTABLE: 'Comptable',
  COMMERCIAL: 'Commercial',
  AGENT_ELEVAGE: "Agent d'élevage",
  MAGASINIER: 'Magasinier',
  AUDITEUR: 'Auditeur',
};

export const USER_COLUMNS: ExportColumn<UserView>[] = [
  { header: 'Nom', value: (u) => u.name },
  { header: 'E-mail', value: (u) => u.email },
  { header: 'Rôle', value: (u) => ROLE_LABEL[u.role] },
  { header: 'Fermes', value: (u) => u.farms.map((f) => f.name).join(', ') },
  { header: 'Statut', value: (u) => (u.active ? 'Actif' : 'Inactif') },
  { header: '2FA', value: (u) => (u.twoFactorEnabled ? 'Oui' : 'Non') },
  {
    header: 'Dernière connexion',
    value: (u) => u.lastLoginAt?.toISOString() ?? null,
  },
];

const SORTABLE = [
  'name',
  'email',
  'role',
  'active',
  'lastLoginAt',
  'createdAt',
];

/** Only these fields ever leave the service: no hash, secret or backup code. */
const toView = (u: UserRow): UserView => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  active: u.active,
  farms: u.farms
    .map((uf) => uf.farm)
    .sort((a, b) => a.name.localeCompare(b.name)),
  twoFactorEnabled: u.totpEnabledAt !== null,
  lastLoginAt: u.lastLoginAt,
});

@Injectable()
export class UsersService implements AuditableService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokensService,
    private readonly audit: AuditService,
  ) {}

  listArgs(ctx: RequestContext, q: ListQueryDto) {
    const where: Prisma.UserWhereInput = {
      organizationId: ctx.user.organizationId,
      ...(q.search
        ? {
            OR: [
              { name: containsInsensitive(q.search) },
              { email: containsInsensitive(q.search) },
            ],
          }
        : {}),
    };
    const order = orderBy(q, SORTABLE, { name: 'asc' });
    return {
      find: async (range: { skip?: number; take: number }) =>
        (
          await this.prisma.user.findMany({
            where,
            include,
            orderBy: [order, { id: 'asc' }],
            ...range,
          })
        ).map(toView),
      count: () => this.prisma.user.count({ where }),
    };
  }

  /** The audited "before" state: the view, never the raw row. */
  async findForAudit(id: string, ctx: RequestContext) {
    const user = await this.find(id, ctx);
    return user ? toView(user) : null;
  }

  private find(id: string, ctx: RequestContext) {
    return this.prisma.user.findFirst({
      where: { id, organizationId: ctx.user.organizationId },
      include,
    });
  }

  private async load(id: string, ctx: RequestContext): Promise<UserRow> {
    const user = await this.find(id, ctx);
    if (!user) throw new NotFoundException('Utilisateur introuvable');
    return user;
  }

  /** Throws 400 unless every id is a farm of the caller's organisation; returns them deduplicated. */
  private async validFarmIds(
    ctx: RequestContext,
    farmIds: string[],
  ): Promise<string[]> {
    const unique = [...new Set(farmIds)];
    const found = await this.prisma.farm.count({
      where: { id: { in: unique }, organizationId: ctx.user.organizationId },
    });
    if (found !== unique.length)
      throw new BadRequestException('Ferme invalide');
    return unique;
  }

  /**
   * Locks the organisation's active super admins and refuses when `userId`
   * is the only one, so two concurrent demotions cannot both succeed.
   */
  private async assertAnotherSuperAdmin(
    tx: Prisma.TransactionClient,
    organizationId: string,
    userId: string,
  ): Promise<void> {
    const admins = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "User"
      WHERE "organizationId" = ${organizationId}
        AND "role" = 'SUPER_ADMIN' AND "active" = true
      FOR UPDATE`;
    if (!admins.some((a) => a.id !== userId)) {
      throw new ConflictException(LAST_ADMIN);
    }
  }

  async create(ctx: RequestContext, dto: CreateUserDto): Promise<UserView> {
    const farmIds = await this.validFarmIds(ctx, dto.farmIds);
    const passwordHash = await hashPassword(dto.password);
    const user = await orConflict(
      () =>
        this.prisma.user.create({
          data: {
            organizationId: ctx.user.organizationId,
            name: dto.name,
            email: dto.email,
            role: dto.role,
            passwordHash,
            farms: { create: farmIds.map((farmId) => ({ farmId })) },
          },
          include,
        }),
      'Cet e-mail est déjà utilisé',
    );
    return toView(user);
  }

  async update(
    ctx: RequestContext,
    id: string,
    dto: UpdateUserDto,
  ): Promise<UserView> {
    const target = await this.load(id, ctx);
    const farmIds = dto.farmIds && (await this.validFarmIds(ctx, dto.farmIds));
    const role = dto.role ?? target.role;
    const active = dto.active ?? target.active;

    const user = await this.prisma.$transaction(async (tx) => {
      const losesAdmin =
        target.role === 'SUPER_ADMIN' &&
        target.active &&
        (!active || role !== 'SUPER_ADMIN');
      if (losesAdmin) {
        await this.assertAnotherSuperAdmin(tx, ctx.user.organizationId, id);
      }
      if (target.active && !active && id === ctx.user.id) {
        throw new ConflictException(
          'Vous ne pouvez pas désactiver votre propre compte',
        );
      }
      if (farmIds) {
        await tx.userFarm.deleteMany({ where: { userId: id } });
        await tx.userFarm.createMany({
          data: farmIds.map((farmId) => ({ userId: id, farmId })),
        });
      }
      return tx.user.update({
        where: { id },
        data: { name: dto.name, role: dto.role, active: dto.active },
        include,
      });
    });

    if (role !== target.role || (target.active && !active)) {
      await this.tokens.revokeAll(id);
    }
    return toView(user);
  }

  async remove(ctx: RequestContext, id: string): Promise<void> {
    const target = await this.load(id, ctx);
    const [audits, logins] = await Promise.all([
      this.prisma.auditLog.count({ where: { userId: id } }),
      this.prisma.loginLog.count({ where: { userId: id } }),
    ]);
    await this.prisma.$transaction(async (tx) => {
      if (target.role === 'SUPER_ADMIN' && target.active) {
        await this.assertAnotherSuperAdmin(tx, ctx.user.organizationId, id);
      }
      if (id === ctx.user.id) {
        throw new ConflictException(
          'Vous ne pouvez pas supprimer votre propre compte',
        );
      }
      if (audits + logins > 0) {
        throw new ConflictException(
          'Cet utilisateur a un historique ; désactivez-le plutôt',
        );
      }
      await tx.refreshToken.deleteMany({ where: { userId: id } });
      await tx.passwordReset.deleteMany({ where: { userId: id } });
      await tx.userFarm.deleteMany({ where: { userId: id } });
      await tx.user.delete({ where: { id } });
    });
  }

  /**
   * One-time 24 h link. Only the SHA-256 of the token is stored (the format
   * `/api/auth/reset-password` looks up). Audited by hand, not with `@Audited`,
   * so the raw token never reaches the audit trail.
   */
  async issueResetLink(
    ctx: RequestContext,
    id: string,
  ): Promise<{ url: string; expiresAt: Date }> {
    const target = await this.load(id, ctx);
    const raw = randomBytes(32).toString('hex');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + RESET_TTL_MS);
    await this.prisma.$transaction([
      this.prisma.passwordReset.updateMany({
        where: { userId: id, usedAt: null, expiresAt: { gt: now } },
        data: { expiresAt: now },
      }),
      this.prisma.passwordReset.create({
        data: { userId: id, tokenHash: sha256(raw), expiresAt },
      }),
    ]);
    await this.tokens.revokeAll(id);
    await this.audit.log({
      ctx,
      module: 'utilisateurs',
      action: 'OTHER',
      recordId: id,
      label: `Lien de réinitialisation : ${target.email}`,
    });
    return { url: `${process.env.WEB_ORIGIN}/reset/${raw}`, expiresAt };
  }

  async resetTwoFactor(ctx: RequestContext, id: string): Promise<void> {
    const target = await this.load(id, ctx);
    await this.prisma.user.update({
      where: { id },
      data: {
        totpSecretEnc: null,
        totpEnabledAt: null,
        totpLastStep: null,
        backupCodes: [],
      },
    });
    await this.tokens.revokeAll(id);
    await this.audit.log({
      ctx,
      module: 'utilisateurs',
      action: 'OTHER',
      recordId: id,
      label: `Réinitialisation 2FA : ${target.email}`,
    });
  }
}
