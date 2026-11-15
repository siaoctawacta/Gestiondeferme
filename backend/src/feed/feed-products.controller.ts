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
  RequirePermission,
  RequireMaster,
} from '../access/decorators';
import type { RequestContext } from '../access/decorators';
import {
  CreateFeedProductDto,
  FeedProductQueryDto,
  UpdateFeedProductDto,
} from './dto/feed-product.dto';
import { FeedProductsService } from './feed-products.service';

/** Products are shared by every farm of the organisation. */
@ApiTags('feed-products')
@Controller('feed-products')
@NoFarm()
export class FeedProductsController {
  constructor(private readonly products: FeedProductsService) {}

  @Get()
  @RequirePermission('alimentation', 'read')
  list(@Ctx() ctx: RequestContext, @Query() q: FeedProductQueryDto) {
    return this.products.list(ctx, q);
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

  @Delete(':id')
  @RequireMaster('alimentation')
  remove(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.products.remove(ctx, id);
  }
}
