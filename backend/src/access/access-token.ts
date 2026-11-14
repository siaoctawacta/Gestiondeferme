import { UnauthorizedException } from '@nestjs/common';
import jwt from 'jsonwebtoken';
import { ALL_ROLES, Role } from './roles';

export type TokenStage = 'full' | '2fa' | 'setup';
const STAGES: TokenStage[] = ['full', '2fa', 'setup'];

export interface AccessClaims {
  sub: string;
  role: Role;
  org: string;
  stage: TokenStage;
}

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

function secret(): string {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET is not set');
  return s;
}

/** `expiresInSeconds` overrides the default 15-minute lifetime (used for the short-lived 2fa/setup tokens). */
export function signAccessToken(
  claims: AccessClaims,
  expiresInSeconds: number = ACCESS_TOKEN_TTL_SECONDS,
): string {
  return jwt.sign(
    { role: claims.role, org: claims.org, stage: claims.stage },
    secret(),
    {
      algorithm: 'HS256',
      subject: claims.sub,
      expiresIn: expiresInSeconds,
    },
  );
}

/** Throws UnauthorizedException when the token is malformed, forged or expired. */
export function verifyAccessToken(token: string): AccessClaims {
  const key = secret(); // outside the try: a missing secret is a server error, not a bad token
  let payload: unknown;
  try {
    payload = jwt.verify(token, key, { algorithms: ['HS256'] });
  } catch {
    throw new UnauthorizedException('Token invalide ou expiré');
  }
  const p = payload as Partial<AccessClaims>;
  if (
    typeof p.sub !== 'string' ||
    typeof p.org !== 'string' ||
    !ALL_ROLES.includes(p.role as Role) ||
    !STAGES.includes(p.stage as TokenStage)
  ) {
    throw new UnauthorizedException('Token invalide');
  }
  return {
    sub: p.sub,
    role: p.role as Role,
    org: p.org,
    stage: p.stage as TokenStage,
  };
}
