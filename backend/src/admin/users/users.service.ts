import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import type { RequestContext } from '../../access/decorators';
import { ALL_FARMS_ROLES } from '../../access/roles';
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
const FARM_REQUIRED = 'Au moins une ferme est requise pour ce rôle';

/** A role outside `ALL_FARMS_ROLES` only sees its assigned farms, so it needs at least one. */
const needsFarm = (role: Role, farmCount: number) =>
  farmCount === 0 && !ALL_FARMS_ROLES.includes(role);

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
  SUPER_ADMIN: 'Super Administrateur',
  PROPRIETAIRE: 'Propriétaire / Direction',
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
   * Locks (FOR UPDATE, in id order, so concurrent transactions cannot deadlock)
   * the target and the organisation's active super admins, then returns the
   * target as it is NOW and whether another active super admin exists. Two
   * concurrent demotions therefore cannot both pass, and decisions are made on
   * the locked row, never on an earlier snapshot.
   */
  private async lockForAdminCheck(
    tx: Prisma.TransactionClient,
    organizationId: string,
    userId: string,
  ): Promise<{
    current: { role: Role; active: boolean };
    otherAdmin: boolean;
  }> {
    const rows = await tx.$queryRaw<
      { id: string; role: Role; active: boolean }[]
    >`
      SELECT "id", "role", "active" FROM "User"
      WHERE "organizationId" = ${organizationId}
        AND ("id" = ${userId} OR ("role" = 'SUPER_ADMIN' AND "active" = true))
      ORDER BY "id"
      FOR UPDATE`;
    const current = rows.find((r) => r.id === userId);
    if (!current) throw new NotFoundException('Utilisateur introuvable');
    const otherAdmin = rows.some(
      (r) => r.id !== userId && r.role === 'SUPER_ADMIN' && r.active,
    );
    return { current, otherAdmin };
  }

  async create(ctx: RequestContext, dto: CreateUserDto): Promise<UserView> {
    if (needsFarm(dto.role, dto.farmIds.length))
      throw new BadRequestException(FARM_REQUIRED);
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
    await this.load(id, ctx); // 404 early, before any hashing or locking
    const farmIds = dto.farmIds && (await this.validFarmIds(ctx, dto.farmIds));

    const { user, revokeSessions } = await this.prisma.$transaction(
      async (tx) => {
        const { current, otherAdmin } = await this.lockForAdminCheck(
          tx,
          ctx.user.organizationId,
          id,
        );
        const role = dto.role ?? current.role;
        const active = dto.active ?? current.active;
        const losesAdmin =
          current.role === 'SUPER_ADMIN' &&
          current.active &&
          (!active || role !== 'SUPER_ADMIN');
        if (losesAdmin && !otherAdmin) throw new ConflictException(LAST_ADMIN);
        if (current.active && !active && id === ctx.user.id) {
          throw new ConflictException(
            'Vous ne pouvez pas désactiver votre propre compte',
          );
        }
        // Only when the body touches role or farms: a legacy farm-less user can still be renamed or deactivated.
        if (dto.role !== undefined || farmIds) {
          const farmCount = farmIds
            ? farmIds.length
            : await tx.userFarm.count({ where: { userId: id } });
          if (needsFarm(role, farmCount))
            throw new BadRequestException(FARM_REQUIRED);
        }
        if (farmIds) {
          await tx.userFarm.deleteMany({ where: { userId: id } });
          await tx.userFarm.createMany({
            data: farmIds.map((farmId) => ({ userId: id, farmId })),
          });
          // An employee may only be linked to a user of its farm: a farm the user left no longer vouches for the link.
          await tx.employee.updateMany({
            where: { userId: id, farmId: { notIn: farmIds } },
            data: { userId: null },
          });
        }
        const updated = await tx.user.update({
          where: { id },
          data: { name: dto.name, role: dto.role, active: dto.active },
          include,
        });
        return {
          user: updated,
          revokeSessions: role !== current.role || (current.active && !active),
        };
      },
    );

    if (revokeSessions) await this.tokens.revokeAll(id);
    return toView(user);
  }

  async remove(ctx: RequestContext, id: string): Promise<void> {
    await this.load(id, ctx);
    await orConflict(() =>
      this.prisma.$transaction(async (tx) => {
        const { current, otherAdmin } = await this.lockForAdminCheck(
          tx,
          ctx.user.organizationId,
          id,
        );
        if (current.role === 'SUPER_ADMIN' && current.active && !otherAdmin) {
          throw new ConflictException(LAST_ADMIN);
        }
        if (id === ctx.user.id) {
          throw new ConflictException(
            'Vous ne pouvez pas supprimer votre propre compte',
          );
        }
        const audits = await tx.auditLog.count({ where: { userId: id } });
        const logins = await tx.loginLog.count({ where: { userId: id } });
        if (audits + logins > 0) {
          throw new ConflictException(
            'Cet utilisateur a un historique ; désactivez-le plutôt',
          );
        }
        await tx.refreshToken.deleteMany({ where: { userId: id } });
        await tx.passwordReset.deleteMany({ where: { userId: id } });
        await tx.userFarm.deleteMany({ where: { userId: id } });
        // The employee the user was linked to stays (an employee needs no account).
        await tx.employee.updateMany({
          where: { userId: id },
          data: { userId: null },
        });
        // Masked alerts are a display preference of the user: they go with him.
        await tx.alertAck.deleteMany({ where: { userId: id } });
        await tx.user.delete({ where: { id } });
      }),
    );
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
