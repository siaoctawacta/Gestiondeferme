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
import { CreateQuoteDto, QuoteQueryDto, UpdateQuoteDto } from './dto/quote.dto';
import { QuotesService } from './quotes.service';
import { QUOTE_COLUMNS } from './sale-view';

/**
 * Permissions on `ventes`: a quote is a daily entry (`create`: create, edit,
 * delete while it is a draft, and every step of its life).
 */
@ApiTags('quotes')
@Controller('quotes')
export class QuotesController {
  constructor(private readonly quotes: QuotesService) {}

  @Get()
  @RequirePermission('ventes', 'read')
  async list(
    @Ctx() ctx: RequestContext,
    @Query() q: QuoteQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const { find, count, statusCounts } = this.quotes.listArgs(ctx, q);
    await sendList(res, q, 'devis', QUOTE_COLUMNS, find, count, statusCounts);
  }

  @Get(':id')
  @RequirePermission('ventes', 'read')
  get(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.quotes.get(ctx, id);
  }

  @Post()
  @RequireDaily('ventes')
  create(@Ctx() ctx: RequestContext, @Body() dto: CreateQuoteDto) {
    return this.quotes.create(ctx, dto);
  }

  @Patch(':id')
  @RequireDaily('ventes')
  update(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: UpdateQuoteDto,
  ) {
    return this.quotes.update(ctx, id, dto);
  }

  @Delete(':id')
  @RequireDaily('ventes')
  remove(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.quotes.remove(ctx, id);
  }

  @Post(':id/send')
  @RequireDaily('ventes')
  send(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.quotes.step(ctx, id, 'send');
  }

  @Post(':id/accept')
  @RequireDaily('ventes')
  accept(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.quotes.step(ctx, id, 'accept');
  }

  @Post(':id/refuse')
  @RequireDaily('ventes')
  refuse(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.quotes.step(ctx, id, 'refuse');
  }

  /** Turns the quote into an invoice draft (lines and prices kept; issued later from the invoice). */
  @Post(':id/convert')
  @RequireDaily('ventes')
  convert(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.quotes.convert(ctx, id);
  }
}
