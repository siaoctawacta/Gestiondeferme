import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Ctx, RequirePermission } from '../access/decorators';
import type { RequestContext } from '../access/decorators';
import { sendList } from '../listing/list-helpers';
import { LotsQueryDto, PeriodQueryDto } from './dto/finance.dto';
import { FinanceSummaryService } from './finance-summary.service';
import {
  LOT_COLUMNS,
  LotProfitabilityService,
} from './lot-profitability.service';

/**
 * The two readings of the money, both `finance:read` only (a role that cannot
 * read lots or pigs still sees lot codes, types and money here): the farm view
 * (`summary`: recettes − dépenses) and the lot view (`lots`: « Marge du lot »).
 */
@ApiTags('finance')
@Controller('finance')
export class FinanceReportsController {
  constructor(
    private readonly summary: FinanceSummaryService,
    private readonly lots: LotProfitabilityService,
  ) {}

  @Get('summary')
  @RequirePermission('finance', 'read')
  get(@Ctx() ctx: RequestContext, @Query() q: PeriodQueryDto) {
    return this.summary.summary(ctx, q);
  }

  @Get('lots')
  @RequirePermission('finance', 'read')
  async list(
    @Ctx() ctx: RequestContext,
    @Query() q: LotsQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const { find, count } = this.lots.listArgs(ctx, q);
    await sendList(res, q, 'rentabilite-lots', LOT_COLUMNS, find, count);
  }

  @Get('lots/:batchId')
  @RequirePermission('finance', 'read')
  lot(
    @Ctx() ctx: RequestContext,
    @Param('batchId') batchId: string,
    @Query() q: PeriodQueryDto,
  ) {
    return this.lots.get(ctx, batchId, q);
  }
}
