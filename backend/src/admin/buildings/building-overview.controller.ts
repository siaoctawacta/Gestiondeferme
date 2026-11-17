import { Controller, Get, Param } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Ctx, RequirePermission } from '../../access/decorators';
import type { RequestContext } from '../../access/decorators';
import { BuildingOverviewDto } from './building-overview';
import { BuildingOverviewService } from './building-overview.service';

@ApiTags('buildings')
@Controller('buildings')
export class BuildingOverviewController {
  constructor(private readonly overview: BuildingOverviewService) {}

  /** What a building's QR label opens. */
  @Get(':id/overview')
  @RequirePermission('batiments', 'read')
  @ApiOkResponse({ type: BuildingOverviewDto })
  get(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
  ): Promise<BuildingOverviewDto> {
    return this.overview.get(ctx, id);
  }
}
