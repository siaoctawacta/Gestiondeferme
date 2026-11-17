import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Ctx, RequireDaily, RequirePermission } from '../access/decorators';
import type { RequestContext } from '../access/decorators';
import { sendList } from '../listing/list-helpers';
import { ListQueryDto } from '../listing/list-query.dto';
import { CreateInventoryDto, SaveInventoryLinesDto } from './dto/inventory.dto';
import { INVENTORY_COLUMNS, InventoriesService } from './inventories.service';

@ApiTags('inventories')
@Controller('inventories')
export class InventoriesController {
  constructor(private readonly inventories: InventoriesService) {}

  @Get()
  @RequirePermission('stocks', 'read')
  async list(
    @Ctx() ctx: RequestContext,
    @Query() q: ListQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const { find, count } = this.inventories.listArgs(ctx, q);
    await sendList(res, q, 'inventaires', INVENTORY_COLUMNS, find, count);
  }

  @Get(':id')
  @RequirePermission('stocks', 'read')
  get(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.inventories.get(ctx, id);
  }

  @Post()
  @RequireDaily('stocks')
  create(@Ctx() ctx: RequestContext, @Body() dto: CreateInventoryDto) {
    return this.inventories.create(ctx, dto);
  }

  @Put(':id/lines')
  @RequireDaily('stocks')
  saveLines(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: SaveInventoryLinesDto,
  ) {
    return this.inventories.saveLines(ctx, id, dto);
  }

  /** Writes the adjustments: the `validate` action of the module, not just `create`. */
  @Post(':id/validate')
  @RequirePermission('stocks', 'validate')
  validate(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.inventories.validate(ctx, id);
  }

  @Delete(':id')
  @RequireDaily('stocks')
  remove(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.inventories.remove(ctx, id);
  }
}
