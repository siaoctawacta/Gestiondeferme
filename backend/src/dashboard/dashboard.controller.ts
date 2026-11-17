import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Ctx, RequirePermission } from '../access/decorators';
import type { RequestContext } from '../access/decorators';
import { DashboardService } from './dashboard.service';
import {
  AlertAckDto,
  AlertKeyDto,
  AlertsDto,
  AlertsQueryDto,
  DashboardDto,
} from './dashboard.types';

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
  alerts(
    @Ctx() ctx: RequestContext,
    @Query() q: AlertsQueryDto,
  ): Promise<AlertsDto> {
    return this.dashboard.alerts(ctx, {
      includeAcknowledged: q.acknowledged === 'include',
    });
  }

  /** « Masquer l'alerte »: a display preference of the caller alone, not audited. */
  @Post('alerts/ack')
  @HttpCode(200)
  @RequirePermission('alertes', 'read')
  @ApiOkResponse({ type: AlertAckDto })
  acknowledge(
    @Ctx() ctx: RequestContext,
    @Body() dto: AlertKeyDto,
  ): Promise<AlertAckDto> {
    return this.dashboard.acknowledge(ctx, dto.key);
  }

  @Post('alerts/unack')
  @HttpCode(200)
  @RequirePermission('alertes', 'read')
  @ApiOkResponse({ type: AlertAckDto })
  unacknowledge(
    @Ctx() ctx: RequestContext,
    @Body() dto: AlertKeyDto,
  ): Promise<AlertAckDto> {
    return this.dashboard.unacknowledge(ctx, dto.key);
  }
}
