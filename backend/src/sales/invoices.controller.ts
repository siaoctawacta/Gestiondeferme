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
  CancelInvoiceDto,
  CreateInvoiceDto,
  CreateIssuedInvoiceDto,
  InvoiceQueryDto,
  IssueInvoiceDto,
  UpdateInvoiceDto,
} from './dto/invoice.dto';
import { CreateClientPaymentDto } from './dto/payment.dto';
import { InvoiceReads } from './invoice-reads.service';
import { PaymentsService } from './payments.service';
import { InvoicesService } from './invoices.service';
import { INVOICE_COLUMNS } from './sale-view';

/**
 * Permissions on `ventes`: a draft is a daily entry (`create`: create, edit,
 * delete while it is a draft); issuing (alone or with the creation) and the
 * client payments, refunds and their deletion are `update`; cancelling an
 * issued invoice is `validate`.
 *
 * `SalesModule` registers `SellablesController` BEFORE this controller, so
 * `GET /sales/sellables` is not taken for `GET /sales/:id`.
 */
@ApiTags('sales')
@Controller('sales')
export class InvoicesController {
  constructor(
    private readonly reads: InvoiceReads,
    private readonly invoices: InvoicesService,
    private readonly payments: PaymentsService,
  ) {}

  @Get()
  @RequirePermission('ventes', 'read')
  async list(
    @Ctx() ctx: RequestContext,
    @Query() q: InvoiceQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const { find, count, statusCounts } = this.reads.listArgs(ctx, q);
    await sendList(
      res,
      q,
      'factures',
      INVOICE_COLUMNS,
      find,
      count,
      statusCounts,
    );
  }

  @Get(':id')
  @RequirePermission('ventes', 'read')
  get(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.reads.get(ctx, id);
  }

  @Post()
  @RequireDaily('ventes')
  create(@Ctx() ctx: RequestContext, @Body() dto: CreateInvoiceDto) {
    return this.invoices.create(ctx, dto);
  }

  /** Create and issue in one transaction (the `Ajouter` dialog's default). */
  @Post('issued')
  @RequirePermission('ventes', 'update')
  createIssued(
    @Ctx() ctx: RequestContext,
    @Body() dto: CreateIssuedInvoiceDto,
  ) {
    return this.invoices.createIssued(ctx, dto);
  }

  @Patch(':id')
  @RequireDaily('ventes')
  update(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: UpdateInvoiceDto,
  ) {
    return this.invoices.update(ctx, id, dto);
  }

  @Delete(':id')
  @RequireDaily('ventes')
  remove(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.invoices.remove(ctx, id);
  }

  @Post(':id/issue')
  @RequirePermission('ventes', 'update')
  issue(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: IssueInvoiceDto,
  ) {
    return this.invoices.issue(ctx, id, dto);
  }

  @Post(':id/cancel')
  @RequirePermission('ventes', 'validate')
  cancel(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: CancelInvoiceDto,
  ) {
    return this.invoices.cancel(ctx, id, dto);
  }

  /**
   * An encashment, or (`kind: REMBOURSEMENT`) the refund of what a credit note
   * left owed back: both need `update`.
   */
  @Post(':id/payments')
  @RequirePermission('ventes', 'update')
  pay(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: CreateClientPaymentDto,
  ) {
    return this.payments.add(ctx, id, dto);
  }

  @Delete(':id/payments/:paymentId')
  @RequirePermission('ventes', 'update')
  unpay(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Param('paymentId') paymentId: string,
  ) {
    return this.payments.remove(ctx, id, paymentId);
  }
}
