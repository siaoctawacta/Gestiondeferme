import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Ctx, RequirePermission } from '../access/decorators';
import type { RequestContext } from '../access/decorators';
import { sendList } from '../listing/list-helpers';
import { PaymentsJournalQueryDto } from './dto/payments-journal.dto';
import { PAYMENT_JOURNAL_COLUMNS, PaymentsJournal } from './payments-journal';

/**
 * Every customer payment of the farms in one list (`ventes:read`).
 * `SalesModule` registers this controller BEFORE `InvoicesController`, so
 * `GET /sales/payments` is not taken for `GET /sales/:id`.
 */
@ApiTags('sales')
@Controller('sales')
export class PaymentsJournalController {
  constructor(private readonly journal: PaymentsJournal) {}

  @Get('payments')
  @RequirePermission('ventes', 'read')
  async list(
    @Ctx() ctx: RequestContext,
    @Query() q: PaymentsJournalQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const { find, count, totals } = this.journal.listArgs(ctx, q);
    await sendList(
      res,
      q,
      'encaissements',
      PAYMENT_JOURNAL_COLUMNS,
      find,
      count,
      totals,
    );
  }
}
