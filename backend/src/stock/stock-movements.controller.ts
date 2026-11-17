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
  CreateMovementDto,
  MovementQueryDto,
  UpdateMovementDto,
} from './dto/stock-movement.dto';
import {
  MOVEMENT_COLUMNS,
  StockMovementsService,
} from './stock-movements.service';

/**
 * Listed before `StockOverviewController` in the module: `GET /stock/movements`
 * must be matched before `GET /stock/:itemId`.
 */
@ApiTags('stock')
@Controller('stock/movements')
export class StockMovementsController {
  constructor(private readonly movements: StockMovementsService) {}

  @Get()
  @RequirePermission('stocks', 'read')
  async list(
    @Ctx() ctx: RequestContext,
    @Query() q: MovementQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const { find, count } = this.movements.listArgs(ctx, q);
    await sendList(res, q, 'mouvements-stock', MOVEMENT_COLUMNS, find, count);
  }

  @Post()
  @RequireDaily('stocks')
  create(@Ctx() ctx: RequestContext, @Body() dto: CreateMovementDto) {
    return this.movements.create(ctx, dto);
  }

  @Patch(':id')
  @RequireDaily('stocks')
  update(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: UpdateMovementDto,
  ) {
    return this.movements.update(ctx, id, dto);
  }

  @Delete(':id')
  @RequireDaily('stocks')
  remove(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.movements.remove(ctx, id);
  }
}
