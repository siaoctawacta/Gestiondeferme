import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import type { Request, Response } from 'express';
import { signAccessToken } from '../access/access-token';
import type { Role } from '../access/roles';
import { PrismaService } from '../prisma/prisma.service';

export const REFRESH_COOKIE = 'ap_refresh';
const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PARTIAL_TOKEN_TTL_SECONDS = 10 * 60;

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  organizationId: string;
  totpEnabledAt: Date | null;
}

export interface SessionUserView {
  id: string;
  name: string;
  email: string;
  role: Role;
  twoFactorEnabled: boolean;
}

export const sha256 = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

export function toUserView(user: SessionUser): SessionUserView {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    twoFactorEnabled: user.totpEnabledAt !== null,
  };
}

const cookieOptions = () =>
  ({
    httpOnly: true,
    sameSite: 'lax',
    path: '/api/auth',
    secure: process.env.NODE_ENV === 'production',
  }) as const;

@Injectable()
export class TokensService {
  constructor(private readonly prisma: PrismaService) {}

  private accessTokenFor(user: SessionUser, stage: 'full' | '2fa' | 'setup') {
    return signAccessToken(
      { sub: user.id, role: user.role, org: user.organizationId, stage },
      stage === 'full' ? undefined : PARTIAL_TOKEN_TTL_SECONDS,
    );
  }

  /** Short-lived token proving the password step; exchanged for a session by the 2FA endpoints. */
  challengeToken(user: SessionUser): string {
    return this.accessTokenFor(user, '2fa');
  }

  /** Short-lived token allowing only the 2FA enrolment endpoints. */
  setupToken(user: SessionUser): string {
    return this.accessTokenFor(user, 'setup');
  }

  /** Creates a refresh token row and sets the cookie; returns the raw token. */
  private async createRefreshToken(userId: string, res: Response) {
    const raw = randomBytes(48).toString('base64url');
    const row = await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: sha256(raw),
        expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
      },
    });
    res.cookie(REFRESH_COOKIE, raw, {
      ...cookieOptions(),
      maxAge: REFRESH_TTL_MS,
    });
    return row;
  }

  /** Full session: refresh cookie + access token. */
  async issueSession(
    user: SessionUser,
    res: Response,
  ): Promise<{ accessToken: string; user: SessionUserView }> {
    await this.createRefreshToken(user.id, res);
    return {
      accessToken: this.accessTokenFor(user, 'full'),
      user: toUserView(user),
    };
  }

  /**
   * Rotates the refresh token presented in the cookie. Presenting a token that
   * was already revoked is treated as theft: every active token of the user is revoked.
   */
  async rotate(req: Request, res: Response) {
    const raw = (req.cookies as Record<string, string> | undefined)?.[
      REFRESH_COOKIE
    ];
    const invalid = () => new UnauthorizedException('Session expirée');
    if (!raw) throw invalid();

    const token = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(raw) },
      include: { user: true },
    });
    if (!token) throw invalid();
    if (token.revokedAt) {
      await this.revokeAll(token.userId);
      this.clearCookie(res);
      throw invalid();
    }
    if (token.expiresAt <= new Date() || !token.user.active) {
      this.clearCookie(res);
      throw invalid();
    }

    // Atomic claim: of two concurrent refreshes with the same token only one wins.
    const claimed = await this.prisma.refreshToken.updateMany({
      where: { id: token.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (claimed.count === 0) {
      await this.revokeAll(token.userId);
      this.clearCookie(res);
      throw invalid();
    }
    const next = await this.createRefreshToken(token.userId, res);
    await this.prisma.refreshToken.update({
      where: { id: token.id },
      data: { replacedById: next.id },
    });
    return {
      accessToken: this.accessTokenFor(token.user, 'full'),
      user: toUserView(token.user),
    };
  }

  /** Revokes the presented refresh token (if any) and clears the cookie. */
  async revokePresented(req: Request, res: Response): Promise<void> {
    const raw = (req.cookies as Record<string, string> | undefined)?.[
      REFRESH_COOKIE
    ];
    if (raw) {
      await this.prisma.refreshToken.updateMany({
        where: { tokenHash: sha256(raw), revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    this.clearCookie(res);
  }

  /** Revokes the user's active refresh tokens, optionally sparing one (by raw value). */
  async revokeAll(userId: string, exceptRaw?: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(exceptRaw ? { tokenHash: { not: sha256(exceptRaw) } } : {}),
      },
      data: { revokedAt: new Date() },
    });
  }

  clearCookie(res: Response): void {
    res.clearCookie(REFRESH_COOKIE, cookieOptions());
  }
}
