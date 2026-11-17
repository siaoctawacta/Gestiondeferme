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
import {
  Ctx,
  NoFarm,
  RequirePermission,
  RequireMaster,
} from '../access/decorators';
import type { RequestContext } from '../access/decorators';
import { sendList } from '../listing/list-helpers';
import {
  CreateFeedProductDto,
  FeedProductQueryDto,
  UpdateFeedProductDto,
} from './dto/feed-product.dto';
import {
  FEED_PRODUCT_COLUMNS,
  FeedProductsService,
} from './feed-products.service';

/** Products are shared by every farm of the organisation. */
@ApiTags('feed-products')
@Controller('feed-products')
@NoFarm()
export class FeedProductsController {
  constructor(private readonly products: FeedProductsService) {}

  @Get()
  @RequirePermission('alimentation', 'read')
  async list(
    @Ctx() ctx: RequestContext,
    @Query() q: FeedProductQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const { find, count } = this.products.listArgs(ctx, q);
    await sendList(res, q, 'aliments', FEED_PRODUCT_COLUMNS, find, count);
  }

  @Post()
  @RequireMaster('alimentation')
  create(@Ctx() ctx: RequestContext, @Body() dto: CreateFeedProductDto) {
    return this.products.create(ctx, dto);
  }

  @Patch(':id')
  @RequireMaster('alimentation')
  update(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: UpdateFeedProductDto,
  ) {
    return this.products.update(ctx, id, dto);
  }

  /** Creates the stock article (Aliment, kg) named after the product and links it. */
  @Post(':id/create-stock-item')
  @RequireMaster('alimentation')
  createStockItem(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.products.createStockItem(ctx, id);
  }

  @Delete(':id')
  @RequireMaster('alimentation')
  remove(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.products.remove(ctx, id);
  }
}
