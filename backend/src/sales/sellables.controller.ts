import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Ctx, RequirePermission } from '../access/decorators';
import type { RequestContext } from '../access/decorators';
import { SellablesQueryDto } from './dto/sellables-query.dto';
import { SellablesService } from './sellables.service';

/**
 * What can be put on a sale line on a given date. Reading it needs `ventes`
 * only: the Commercial sells lots, animals, eggs and stock without managing
 * them, so the answer carries nothing but codes, labels and availability.
 */
@ApiTags('sales')
@Controller('sales')
export class SellablesController {
  constructor(private readonly sellables: SellablesService) {}

  @Get('sellables')
  @RequirePermission('ventes', 'read')
  list(@Ctx() ctx: RequestContext, @Query() q: SellablesQueryDto) {
    return this.sellables.list(ctx, q);
  }
}
