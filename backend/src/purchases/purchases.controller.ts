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
  CancelPurchaseDto,
  CreatePaymentDto,
  CreatePurchaseDto,
  PurchaseQueryDto,
  ReceivePurchaseDto,
  UpdatePurchaseDto,
} from './dto/purchase.dto';
import { PURCHASE_COLUMNS } from './purchase-view';
import { PurchasesService } from './purchases.service';

/**
 * Permissions on `achats`: a request is a daily entry (`create`: create, edit,
 * delete while it is a `DEMANDE`); validating, ordering, cancelling and the
 * supplier payments need `validate`; receiving into the stock needs `update`.
 */
@ApiTags('purchases')
@Controller('purchases')
export class PurchasesController {
  constructor(private readonly purchases: PurchasesService) {}

  @Get()
  @RequirePermission('achats', 'read')
  async list(
    @Ctx() ctx: RequestContext,
    @Query() q: PurchaseQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const { find, count, statusCounts } = this.purchases.listArgs(ctx, q);
    await sendList(
      res,
      q,
      'achats',
      PURCHASE_COLUMNS,
      find,
      count,
      statusCounts,
    );
  }

  @Get(':id')
  @RequirePermission('achats', 'read')
  get(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.purchases.get(ctx, id);
  }

  @Post()
  @RequireDaily('achats')
  create(@Ctx() ctx: RequestContext, @Body() dto: CreatePurchaseDto) {
    return this.purchases.create(ctx, dto);
  }

  @Patch(':id')
  @RequireDaily('achats')
  update(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: UpdatePurchaseDto,
  ) {
    return this.purchases.update(ctx, id, dto);
  }

  @Delete(':id')
  @RequireDaily('achats')
  remove(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.purchases.remove(ctx, id);
  }

  @Post(':id/validate')
  @RequirePermission('achats', 'validate')
  validate(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.purchases.validate(ctx, id);
  }

  /** Assigns the `BC-NNNN` order number. */
  @Post(':id/order')
  @RequirePermission('achats', 'validate')
  order(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.purchases.order(ctx, id);
  }

  @Post(':id/receive')
  @RequirePermission('achats', 'update')
  receive(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: ReceivePurchaseDto,
  ) {
    return this.purchases.receive(ctx, id, dto);
  }

  @Post(':id/cancel')
  @RequirePermission('achats', 'validate')
  cancel(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: CancelPurchaseDto,
  ) {
    return this.purchases.cancel(ctx, id, dto);
  }

  @Post(':id/payments')
  @RequirePermission('achats', 'validate')
  addPayment(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: CreatePaymentDto,
  ) {
    return this.purchases.addPayment(ctx, id, dto);
  }

  @Delete(':id/payments/:paymentId')
  @RequirePermission('achats', 'validate')
  removePayment(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Param('paymentId') paymentId: string,
  ) {
    return this.purchases.removePayment(ctx, id, paymentId);
  }
}
