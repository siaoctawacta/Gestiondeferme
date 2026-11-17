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
import { Ctx, RequirePermission, RequireDaily } from '../access/decorators';
import type { RequestContext } from '../access/decorators';
import { sendList } from '../listing/list-helpers';
import {
  CreateFeedDistributionDto,
  FeedListQueryDto,
  UpdateFeedDistributionDto,
} from './dto/feed-distribution.dto';
import {
  columnsFor,
  FeedDistributionsService,
  hideCost,
} from './feed-distributions.service';

@ApiTags('feed-distributions')
@Controller('feed-distributions')
export class FeedDistributionsController {
  constructor(private readonly distributions: FeedDistributionsService) {}

  @Get()
  @RequirePermission('alimentation', 'read')
  async list(
    @Ctx() ctx: RequestContext,
    @Query() q: FeedListQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const { find, count } = this.distributions.listArgs(ctx, q);
    await sendList(
      res,
      q,
      'alimentation-eau',
      columnsFor(ctx),
      async (range) => (await find(range)).map((d) => hideCost(ctx, d)),
      count,
    );
  }

  @Post()
  @RequireDaily('alimentation')
  async create(
    @Ctx() ctx: RequestContext,
    @Body() dto: CreateFeedDistributionDto,
  ) {
    return hideCost(ctx, await this.distributions.create(ctx, dto));
  }

  @Patch(':id')
  @RequireDaily('alimentation')
  async update(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: UpdateFeedDistributionDto,
  ) {
    return hideCost(ctx, await this.distributions.update(ctx, id, dto));
  }

  @Delete(':id')
  @RequireDaily('alimentation')
  remove(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.distributions.remove(ctx, id);
  }
}
