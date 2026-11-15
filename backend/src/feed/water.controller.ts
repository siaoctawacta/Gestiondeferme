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
import { Ctx, RequirePermission, RequireDaily } from '../access/decorators';
import type { RequestContext } from '../access/decorators';
import { FeedListQueryDto } from './dto/feed-distribution.dto';
import { CreateWaterDto, UpdateWaterDto } from './dto/water.dto';
import { WaterService } from './water.service';

@ApiTags('water')
@Controller('water')
export class WaterController {
  constructor(private readonly water: WaterService) {}

  @Get()
  @RequirePermission('alimentation', 'read')
  list(@Ctx() ctx: RequestContext, @Query() q: FeedListQueryDto) {
    return this.water.list(ctx, q);
  }

  @Post()
  @RequireDaily('alimentation')
  create(@Ctx() ctx: RequestContext, @Body() dto: CreateWaterDto) {
    return this.water.create(ctx, dto);
  }

  @Patch(':id')
  @RequireDaily('alimentation')
  update(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: UpdateWaterDto,
  ) {
    return this.water.update(ctx, id, dto);
  }

  @Delete(':id')
  @RequireDaily('alimentation')
  remove(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.water.remove(ctx, id);
  }
}
