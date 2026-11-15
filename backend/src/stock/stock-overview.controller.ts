import { Body, Controller, Get, Param, Put, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Ctx, RequireMaster, RequirePermission } from '../access/decorators';
import type { RequestContext } from '../access/decorators';
import { sendList } from '../listing/list-helpers';
import { SetThresholdsDto, StockListQueryDto } from './dto/stock-list.dto';
import { STOCK_COLUMNS, StockOverviewService } from './stock-overview.service';

@ApiTags('stock')
@Controller('stock')
export class StockOverviewController {
  constructor(private readonly overview: StockOverviewService) {}

  @Get()
  @RequirePermission('stocks', 'read')
  async list(
    @Ctx() ctx: RequestContext,
    @Query() q: StockListQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const { find, count, extra } = this.overview.listArgs(ctx, q);
    await sendList(res, q, 'stock', STOCK_COLUMNS, find, count, extra);
  }

  @Get(':itemId')
  @RequirePermission('stocks', 'read')
  detail(@Ctx() ctx: RequestContext, @Param('itemId') itemId: string) {
    return this.overview.detail(ctx, itemId);
  }

  /** Thresholds belong to the selected farm and define what the farm's stock levels mean. */
  @Put(':itemId/thresholds')
  @RequireMaster('stocks')
  setThresholds(
    @Ctx() ctx: RequestContext,
    @Param('itemId') itemId: string,
    @Body() dto: SetThresholdsDto,
  ) {
    return this.overview.setThresholds(ctx, itemId, dto);
  }
}
