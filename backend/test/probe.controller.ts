import { Controller, Get, Post } from '@nestjs/common';
import {
  AllowStage,
  AnyAuthenticated,
  Ctx,
  NoFarm,
  RequirePermission,
} from '../src/access/decorators';
import type { RequestContext } from '../src/access/decorators';

/** Test-only controller. Registered by createTestApp, never by AppModule. */
@Controller('_probe')
export class ProbeController {
  @Get()
  @RequirePermission('lots', 'create')
  write(@Ctx() ctx: RequestContext): RequestContext {
    return ctx;
  }

  /** Farm-scoped, any role: GET may use `X-Farm-Id: all`, the POST may not. */
  @Get('authed-farm')
  @AnyAuthenticated()
  authedFarmRead(@Ctx() ctx: RequestContext): RequestContext {
    return ctx;
  }

  @Post('authed-farm')
  @AnyAuthenticated()
  authedFarmWrite(@Ctx() ctx: RequestContext): RequestContext {
    return ctx;
  }

  /** Deliberately has neither marker: the guard must fail closed. */
  @Post('undecorated')
  undecorated(@Ctx() ctx: RequestContext): RequestContext {
    return ctx;
  }

  @Get('read')
  @RequirePermission('lots', 'read')
  read(@Ctx() ctx: RequestContext): RequestContext {
    return ctx;
  }

  @Get('nofarm')
  @NoFarm()
  @RequirePermission('lots', 'read')
  noFarm(@Ctx() ctx: RequestContext): RequestContext {
    return ctx;
  }

  @Get('authed')
  @NoFarm()
  @AnyAuthenticated()
  authed(@Ctx() ctx: RequestContext): RequestContext {
    return ctx;
  }

  @Get('setup')
  @NoFarm()
  @AnyAuthenticated()
  @AllowStage('setup', '2fa')
  setup(@Ctx() ctx: RequestContext): RequestContext {
    return ctx;
  }
}
