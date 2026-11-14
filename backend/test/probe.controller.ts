import { Controller, Get, Post } from '@nestjs/common';
import {
  AllowStage,
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
  authed(@Ctx() ctx: RequestContext): RequestContext {
    return ctx;
  }

  @Get('setup')
  @NoFarm()
  @AllowStage('setup', '2fa')
  setup(@Ctx() ctx: RequestContext): RequestContext {
    return ctx;
  }
}
