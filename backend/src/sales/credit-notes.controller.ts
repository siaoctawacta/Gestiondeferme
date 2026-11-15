import { Body, Controller, Get, Param, Post, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Ctx, RequirePermission } from '../access/decorators';
import type { RequestContext } from '../access/decorators';
import { sendList } from '../listing/list-helpers';
import { CREDIT_NOTE_COLUMNS } from './credit-note-view';
import { CreditNotesService } from './credit-notes.service';
import { CreateCreditNoteDto, CreditNoteQueryDto } from './dto/credit-note.dto';

/**
 * Credit notes: made from an invoice (`POST /sales/:id/credit-notes`,
 * `ventes:validate`), then read-only (`ventes:read`): a credit note is final.
 */
@ApiTags('sales')
@Controller()
export class CreditNotesController {
  constructor(private readonly notes: CreditNotesService) {}

  @Post('sales/:id/credit-notes')
  @RequirePermission('ventes', 'validate')
  create(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: CreateCreditNoteDto,
  ) {
    return this.notes.create(ctx, id, dto);
  }

  @Get('credit-notes')
  @RequirePermission('ventes', 'read')
  async list(
    @Ctx() ctx: RequestContext,
    @Query() q: CreditNoteQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const { find, count } = this.notes.listArgs(ctx, q);
    await sendList(res, q, 'avoirs', CREDIT_NOTE_COLUMNS, find, count);
  }

  @Get('credit-notes/:id')
  @RequirePermission('ventes', 'read')
  get(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.notes.get(ctx, id);
  }
}
