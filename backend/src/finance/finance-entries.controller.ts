import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Ctx, RequireDaily, RequirePermission } from '../access/decorators';
import type { RequestContext } from '../access/decorators';
import { sendList } from '../listing/list-helpers';
import {
  CreateFinanceEntryDto,
  FinanceEntriesQueryDto,
  LotOptionsQueryDto,
  UpdateFinanceEntryDto,
} from './dto/finance.dto';
import { ENTRY_COLUMNS } from './finance-entry-view';
import { FinanceEntriesService } from './finance-entries.service';
import { LotProfitabilityService } from './lot-profitability.service';

/**
 * Permissions on `finance`: reading the list (manual and derived rows) and the
 * lot options needs `read`; a manual entry is a daily entry (`create` for
 * create, edit and delete). A derived row has no route of its own: writing to
 * its id is a 409.
 */
@ApiTags('finance')
@Controller('finance')
export class FinanceEntriesController {
  constructor(
    private readonly entries: FinanceEntriesService,
    private readonly lots: LotProfitabilityService,
  ) {}

  @Get('entries')
  @RequirePermission('finance', 'read')
  async list(
    @Ctx() ctx: RequestContext,
    @Query() q: FinanceEntriesQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const { find, count, totals } = this.entries.listArgs(ctx, q);
    await sendList(res, q, 'finance', ENTRY_COLUMNS, find, count, totals);
  }

  /** The open lots of an activity, for the lot select of a manual expense (finance read only: codes). */
  @Get('lot-options')
  @RequirePermission('finance', 'read')
  lotOptions(@Ctx() ctx: RequestContext, @Query() q: LotOptionsQueryDto) {
    return this.lots.options(ctx, q.activity);
  }

  @Post('entries')
  @RequireDaily('finance')
  create(@Ctx() ctx: RequestContext, @Body() dto: CreateFinanceEntryDto) {
    return this.entries.create(ctx, dto);
  }

  @Patch('entries/:id')
  @RequireDaily('finance')
  update(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: UpdateFinanceEntryDto,
  ) {
    return this.entries.update(ctx, id, dto);
  }

  @Delete('entries/:id')
  @RequireDaily('finance')
  remove(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.entries.remove(ctx, id);
  }
}
