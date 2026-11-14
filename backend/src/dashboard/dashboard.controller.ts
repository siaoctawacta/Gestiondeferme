import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Ctx, RequirePermission } from '../access/decorators';
import type { RequestContext } from '../access/decorators';
import { DashboardService } from './dashboard.service';
import { AlertsDto, DashboardDto } from './dashboard.types';

@ApiTags('dashboard')
@Controller()
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('dashboard')
  @RequirePermission('dashboard', 'read')
  @ApiOkResponse({ type: DashboardDto })
  get(@Ctx() ctx: RequestContext): Promise<DashboardDto> {
    return this.dashboard.get(ctx);
  }

  @Get('alerts')
  @RequirePermission('alertes', 'read')
  @ApiOkResponse({ type: AlertsDto })
  alerts(@Ctx() ctx: RequestContext): Promise<AlertsDto> {
    return this.dashboard.alerts(ctx);
  }
}
