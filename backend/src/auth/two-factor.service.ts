import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { randomInt } from 'crypto';
import type { Request, Response } from 'express';
import QRCode from 'qrcode';
import type { TokenStage } from '../access/access-token';
import { AuthService, MANDATORY_2FA_ROLES } from './auth.service';
import { decrypt, encrypt, hashBackupCode } from './crypto';
import { verifyPassword } from './password';
import { TokensService } from './tokens.service';
import { matchTotpStep, newTotpSecret, otpauthUrl } from './totp';
import { PrismaService } from '../prisma/prisma.service';

const BACKUP_CODE_COUNT = 8;
const BACKUP_CODE_LENGTH = 10;
// No 0/O/1/I/L: codes are read aloud and typed by hand.
const BACKUP_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const TOTP_PATTERN = /^\d{6}$/;

const normalizeBackupCode = (code: string): string =>
  code.replace(/[\s-]/g, '').toUpperCase();

function generateBackupCodes(): string[] {
  return Array.from({ length: BACKUP_CODE_COUNT }, () =>
    Array.from(
      { length: BACKUP_CODE_LENGTH },
      () => BACKUP_ALPHABET[randomInt(BACKUP_ALPHABET.length)],
    ).join(''),
  );
}

@Injectable()
export class TwoFactorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly tokens: TokensService,
  ) {}

  /** Creates a pending secret (replacing any earlier pending one); 2FA stays off until `enable`. */
  async setup(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    if (user.totpEnabledAt) {
      throw new ConflictException(
        'La double authentification est déjà activée',
      );
    }
    const secret = newTotpSecret();
    await this.prisma.user.update({
      where: { id: userId },
      data: { totpSecretEnc: encrypt(secret), totpLastStep: null },
    });
    const url = otpauthUrl(secret, user.email);
    return { otpauthUrl: url, qrDataUrl: await QRCode.toDataURL(url), secret };
  }

  async enable(userId: string, code: string, stage: TokenStage, res: Response) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    if (user.totpEnabledAt) {
      throw new BadRequestException(
        'La double authentification est déjà activée',
      );
    }
    if (!user.totpSecretEnc) {
      throw new BadRequestException('Lancez d’abord la configuration');
    }
    const step = TOTP_PATTERN.test(code)
      ? matchTotpStep(decrypt(user.totpSecretEnc), code)
      : null;
    if (step === null) throw new BadRequestException('Code invalide');

    const backupCodes = generateBackupCodes();
    // Atomic: two concurrent enables cannot both succeed.
    const enabledAt = new Date();
    const claimed = await this.prisma.user.updateMany({
      where: {
        id: userId,
        totpEnabledAt: null,
        totpSecretEnc: user.totpSecretEnc,
      },
      data: {
        totpEnabledAt: enabledAt,
        totpLastStep: step,
        backupCodes: backupCodes.map((c) => hashBackupCode(c)),
      },
    });
    if (claimed.count === 0) {
      throw new BadRequestException(
        'La double authentification est déjà activée',
      );
    }
    if (stage === 'setup') {
      const session = await this.tokens.issueSession(
        { ...user, totpEnabledAt: enabledAt },
        res,
      );
      return { backupCodes, ...session };
    }
    return { backupCodes };
  }

  /** Second login step: trades the challenge token plus a valid code for a session. */
  async verify(userId: string, code: string, req: Request, res: Response) {
    let user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    const now = new Date();
    if (user.lockedUntil && user.lockedUntil > now) {
      await this.auth.log(user.email, false, user.id, req);
      throw this.auth.lockedError(user.lockedUntil);
    }
    if (user.lockedUntil) {
      await this.prisma.user.updateMany({
        where: { id: user.id, lockedUntil: { lte: now } },
        data: { failedLogins: 0, lockedUntil: null },
      });
      user = { ...user, failedLogins: 0, lockedUntil: null };
    }
    if (!user.totpEnabledAt) {
      throw new UnauthorizedException('Code invalide');
    }

    if (!(await this.consumeCode(user, code))) {
      await this.auth.registerFailure(user.id);
      await this.auth.log(user.email, false, user.id, req);
      throw new UnauthorizedException('Code invalide');
    }

    // Conditional like the password path: a lock set meanwhile still wins.
    const reset = await this.prisma.user.updateMany({
      where: {
        id: user.id,
        OR: [{ lockedUntil: null }, { lockedUntil: { lte: new Date() } }],
      },
      data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() },
    });
    if (reset.count === 0) {
      const current = await this.prisma.user.findUniqueOrThrow({
        where: { id: user.id },
      });
      await this.auth.log(user.email, false, user.id, req);
      throw this.auth.lockedError(current.lockedUntil ?? new Date());
    }
    await this.auth.log(user.email, true, user.id, req);
    return this.tokens.issueSession(user, res);
  }

  async disable(userId: string, password: string, code: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    if (MANDATORY_2FA_ROLES.includes(user.role)) {
      throw new ForbiddenException(
        'La double authentification est obligatoire pour ce rôle',
      );
    }
    if (!user.totpEnabledAt) {
      throw new BadRequestException(
        'La double authentification n’est pas activée',
      );
    }
    if (!(await verifyPassword(user.passwordHash, password))) {
      throw new BadRequestException('Mot de passe incorrect');
    }
    if (!(await this.consumeCode(user, code))) {
      throw new BadRequestException('Code invalide');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        totpEnabledAt: null,
        totpSecretEnc: null,
        totpLastStep: null,
        backupCodes: [],
      },
    });
  }

  /**
   * True when `code` is a TOTP code for a step newer than the last accepted one
   * (claimed atomically), or an unused backup code (removed atomically).
   */
  private async consumeCode(
    user: { id: string; totpSecretEnc: string | null },
    code: string,
  ): Promise<boolean> {
    if (TOTP_PATTERN.test(code)) {
      if (!user.totpSecretEnc) return false;
      const step = matchTotpStep(decrypt(user.totpSecretEnc), code);
      if (step === null) return false;
      const claimed = await this.prisma.user.updateMany({
        where: {
          id: user.id,
          OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }],
        },
        data: { totpLastStep: step },
      });
      return claimed.count === 1;
    }
    const hash = hashBackupCode(normalizeBackupCode(code));
    const removed = await this.prisma.$executeRaw`
      UPDATE "User"
      SET "backupCodes" = array_remove("backupCodes", ${hash})
      WHERE "id" = ${user.id} AND ${hash} = ANY("backupCodes")`;
    return removed === 1;
  }
}
