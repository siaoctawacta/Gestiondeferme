import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { TokenStage, verifyAccessToken } from './access-token';
import { AccessService } from './access.service';
import {
  ALLOW_STAGE_KEY,
  IS_PUBLIC_KEY,
  NO_FARM_KEY,
  PERMISSION_KEY,
  RequestContext,
} from './decorators';
import { Action, can, ModuleKey } from './permissions';

@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly access: AccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const meta = <T>(key: string): T | undefined =>
      this.reflector.getAllAndOverride<T>(key, [
        context.getHandler(),
        context.getClass(),
      ]);

    if (meta<boolean>(IS_PUBLIC_KEY)) return true;

    const req = context
      .switchToHttp()
      .getRequest<Request & { ctx?: RequestContext }>();
    const [scheme, token] = (req.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedException('Authentification requise');
    }
    const claims = verifyAccessToken(token);

    const allowedStages = meta<TokenStage[]>(ALLOW_STAGE_KEY) ?? ['full'];
    if (!allowedStages.includes(claims.stage)) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        message: 'Authentification à deux facteurs requise',
        code: 'TWO_FACTOR_REQUIRED',
      });
    }

    const user = await this.access.loadUser(claims);

    const required = meta<{ module: ModuleKey; action: Action }>(
      PERMISSION_KEY,
    );
    if (required && !can(user.role, required.module, required.action)) {
      throw new ForbiddenException('Permission insuffisante');
    }

    // Farm scoping applies to full sessions on routes that did not opt out.
    const farmScoped = !meta<boolean>(NO_FARM_KEY) && claims.stage === 'full';
    const farms = farmScoped
      ? await this.access.resolveFarms(
          user,
          req.headers['x-farm-id'] as string | undefined,
          !required || required.action === 'read',
        )
      : { farmId: null, allFarms: false, farmIds: [] };

    req.ctx = { user, ...farms };
    return true;
  }
}
