import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  Ctx,
  NoFarm,
  RequireMaster,
  RequirePermission,
} from '../access/decorators';
import type { RequestContext } from '../access/decorators';
import {
  CreateStockItemDto,
  StockItemQueryDto,
  UpdateStockItemDto,
} from './dto/stock-item.dto';
import { StockItemsService } from './stock-items.service';

/** The catalogue of articles is shared by every farm of the organisation. */
@ApiTags('stock-items')
@Controller('stock-items')
@NoFarm()
export class StockItemsController {
  constructor(private readonly items: StockItemsService) {}

  @Get()
  @RequirePermission('stocks', 'read')
  list(@Ctx() ctx: RequestContext, @Query() q: StockItemQueryDto) {
    return this.items.list(ctx, q);
  }

  @Post()
  @RequireMaster('stocks')
  create(@Ctx() ctx: RequestContext, @Body() dto: CreateStockItemDto) {
    return this.items.create(ctx, dto);
  }

  @Patch(':id')
  @RequireMaster('stocks')
  update(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: UpdateStockItemDto,
  ) {
    return this.items.update(ctx, id, dto);
  }

  @Delete(':id')
  @RequireMaster('stocks')
  remove(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.items.remove(ctx, id);
  }
}
