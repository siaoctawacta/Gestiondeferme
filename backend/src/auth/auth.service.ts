import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { permissionsFor } from '../access/permissions';
import { ALL_FARMS_ROLES, Role } from '../access/roles';
import { PrismaService } from '../prisma/prisma.service';
import { hashPassword, MIN_PASSWORD_LENGTH, verifyPassword } from './password';
import {
  REFRESH_COOKIE,
  SessionUser,
  sha256,
  toUserView,
  TokensService,
} from './tokens.service';

const MAX_FAILED_LOGINS = 5;
const LOCK_MS = 15 * 60 * 1000;
export const MANDATORY_2FA_ROLES: Role[] = [
  'SUPER_ADMIN',
  'PROPRIETAIRE',
  'DIRECTEUR_FERME',
  'COMPTABLE',
];

export type LoginOutcome = 'full' | 'twoFactor' | 'twoFactorSetup';

/** What the password step leads to: a session, a 2FA challenge, or a mandatory 2FA enrolment. */
export function decideLoginOutcome(
  role: Role,
  totpEnabledAt: Date | null,
): LoginOutcome {
  if (totpEnabledAt) return 'twoFactor';
  return MANDATORY_2FA_ROLES.includes(role) ? 'twoFactorSetup' : 'full';
}

export type LoginResult =
  | { accessToken: string; user: ReturnType<typeof toUserView> }
  | { twoFactorRequired: true; challengeToken: string }
  | { twoFactorSetupRequired: true; setupToken: string };

const INVALID = 'Identifiants invalides';

@Injectable()
export class AuthService {
  /** Verified when the email is unknown so both failures cost the same time. */
  private dummyHash?: Promise<string>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokensService,
  ) {}

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= hashPassword('dummy-password-for-timing');
    return this.dummyHash;
  }

  async log(
    email: string,
    success: boolean,
    userId: string | null,
    req: Request,
  ): Promise<void> {
    await this.prisma.loginLog.create({
      data: {
        email,
        success,
        userId,
        ip: req.ip ?? null,
        userAgent: req.headers['user-agent'] ?? null,
      },
    });
  }

  async login(
    email: string,
    password: string,
    req: Request,
    res: Response,
  ): Promise<LoginResult> {
    const normalized = email.trim().toLowerCase();
    let user = await this.prisma.user.findUnique({
      where: { email: normalized },
    });

    if (!user) {
      await verifyPassword(await this.getDummyHash(), password);
      await this.log(normalized, false, null, req);
      throw new UnauthorizedException(INVALID);
    }

    const now = new Date();
    if (user.lockedUntil && user.lockedUntil > now) {
      await this.log(normalized, false, user.id, req);
      throw this.lockedError(user.lockedUntil);
    }
    if (user.lockedUntil) {
      // The lock has expired: start a fresh count.
      // Conditional so a lock set by a concurrent request is never wiped.
      await this.prisma.user.updateMany({
        where: { id: user.id, lockedUntil: { lte: now } },
        data: { failedLogins: 0, lockedUntil: null },
      });
      user = { ...user, failedLogins: 0, lockedUntil: null };
    }

    const passwordOk = await verifyPassword(user.passwordHash, password);
    if (!passwordOk || !user.active) {
      if (!passwordOk) await this.registerFailure(user.id);
      await this.log(normalized, false, user.id, req);
      throw new UnauthorizedException(INVALID);
    }

    // A lock set by a concurrent failed attempt while we were verifying the
    // password must still win. When a second factor is required the failure
    // counter is NOT reset here (otherwise an attacker holding the password
    // could loop password + 4 guesses forever); `verify` resets it on success.
    const outcome = decideLoginOutcome(user.role, user.totpEnabledAt);
    const notLocked = {
      id: user.id,
      OR: [{ lockedUntil: null }, { lockedUntil: { lte: new Date() } }],
    };
    const proceeds =
      outcome === 'twoFactor'
        ? (await this.prisma.user.count({ where: notLocked })) > 0
        : (
            await this.prisma.user.updateMany({
              where: notLocked,
              data: { failedLogins: 0, lockedUntil: null, lastLoginAt: now },
            })
          ).count > 0;
    if (!proceeds) {
      const current = await this.prisma.user.findUniqueOrThrow({
        where: { id: user.id },
      });
      await this.log(normalized, false, user.id, req);
      throw this.lockedError(
        current.lockedUntil ?? new Date(Date.now() + LOCK_MS),
      );
    }
    await this.log(normalized, true, user.id, req);

    const session: SessionUser = user;
    switch (outcome) {
      case 'twoFactor':
        return {
          twoFactorRequired: true,
          challengeToken: this.tokens.challengeToken(session),
        };
      case 'twoFactorSetup':
        return {
          twoFactorSetupRequired: true,
          setupToken: this.tokens.setupToken(session),
        };
      default:
        return this.tokens.issueSession(session, res);
    }
  }

  lockedError(lockedUntil: Date): HttpException {
    return new HttpException(
      {
        statusCode: HttpStatus.LOCKED,
        error: 'Locked',
        message:
          'Compte verrouillé après trop de tentatives. Réessayez plus tard.',
        lockedUntil: lockedUntil.toISOString(),
      },
      HttpStatus.LOCKED,
    );
  }

  /** One atomic statement: concurrent failures cannot under-count or miss the lock. */
  async registerFailure(userId: string): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE "User"
      SET "failedLogins" = "failedLogins" + 1,
          "lockedUntil" = CASE
            WHEN "failedLogins" + 1 >= ${MAX_FAILED_LOGINS}
            THEN now() + ${LOCK_MS / 1000} * interval '1 second'
            ELSE "lockedUntil" END
      WHERE "id" = ${userId}`;
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    const seesAll = ALL_FARMS_ROLES.includes(user.role);
    const farms = await this.prisma.farm.findMany({
      where: {
        organizationId: user.organizationId,
        ...(seesAll ? {} : { userFarms: { some: { userId: user.id } } }),
      },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    return {
      user: toUserView(user),
      farms,
      permissions: permissionsFor(user.role),
      canSeeAllFarms: seesAll,
    };
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    req: Request,
  ): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    if (!(await verifyPassword(user.passwordHash, currentPassword))) {
      throw new BadRequestException('Mot de passe actuel incorrect');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await hashPassword(newPassword) },
    });
    const current = (req.cookies as Record<string, string> | undefined)?.[
      REFRESH_COOKIE
    ];
    await this.tokens.revokeAll(userId, current);
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      throw new BadRequestException('Mot de passe trop court');
    }
    const invalid = () =>
      new BadRequestException('Lien de réinitialisation invalide ou expiré');
    const reset = await this.prisma.passwordReset.findUnique({
      where: { tokenHash: sha256(token) },
    });
    if (!reset || reset.usedAt || reset.expiresAt <= new Date()) {
      throw invalid();
    }
    const passwordHash = await hashPassword(newPassword);
    await this.prisma.$transaction(async (tx) => {
      // Atomic claim so a token cannot be used twice concurrently.
      const claimed = await tx.passwordReset.updateMany({
        where: { id: reset.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (claimed.count === 0) throw invalid();
      await tx.user.update({
        where: { id: reset.userId },
        data: { passwordHash, failedLogins: 0, lockedUntil: null },
      });
      await tx.refreshToken.updateMany({
        where: { userId: reset.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });
  }
}
