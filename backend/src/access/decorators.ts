import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import type { Request } from 'express';
import type { TokenStage } from './access-token';
import type { Action, ModuleKey } from './permissions';
import type { Role } from './roles';

export interface RequestContext {
  user: { id: string; name: string; role: Role; organizationId: string };
  /** The selected farm, or null for `X-Farm-Id: all` and `@NoFarm()` routes. */
  farmId: string | null;
  allFarms: boolean;
  /** Farms the request may touch: every organisation farm for `all`, `[farmId]` otherwise. */
  farmIds: string[];
}

export const IS_PUBLIC_KEY = 'access:public';
export const NO_FARM_KEY = 'access:noFarm';
export const PERMISSION_KEY = 'access:permission';
export const ALLOW_STAGE_KEY = 'access:allowStage';

export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
export const NoFarm = () => SetMetadata(NO_FARM_KEY, true);
export const RequirePermission = (module: ModuleKey, action: Action) =>
  SetMetadata(PERMISSION_KEY, { module, action });
/** Accept tokens of these stages (instead of only `full`) on this route. */
export const AllowStage = (...stages: TokenStage[]) =>
  SetMetadata(ALLOW_STAGE_KEY, stages);

export const Ctx = createParamDecorator(
  (_data: unknown, context: ExecutionContext): RequestContext =>
    context.switchToHttp().getRequest<Request & { ctx: RequestContext }>().ctx,
);
