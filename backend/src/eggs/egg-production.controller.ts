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
import { Ctx, RequirePermission } from '../access/decorators';
import type { RequestContext } from '../access/decorators';
import { sendList } from '../listing/list-helpers';
import {
  CreateEggProductionDto,
  EggListQueryDto,
  UpdateEggProductionDto,
} from './dto/egg-production.dto';
import { EGG_COLUMNS, EggProductionService } from './egg-production.service';

@ApiTags('egg-production')
@Controller('egg-production')
export class EggProductionController {
  constructor(private readonly eggs: EggProductionService) {}

  @Get()
  @RequirePermission('ponte', 'read')
  async list(
    @Ctx() ctx: RequestContext,
    @Query() q: EggListQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const { find, count } = this.eggs.listArgs(ctx, q);
    await sendList(res, q, 'production-oeufs', EGG_COLUMNS, find, count);
  }

  @Post()
  @RequirePermission('ponte', 'create')
  create(@Ctx() ctx: RequestContext, @Body() dto: CreateEggProductionDto) {
    return this.eggs.create(ctx, dto);
  }

  @Patch(':id')
  @RequirePermission('ponte', 'update')
  update(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: UpdateEggProductionDto,
  ) {
    return this.eggs.update(ctx, id, dto);
  }

  @Delete(':id')
  @RequirePermission('ponte', 'delete')
  async remove(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    await this.eggs.remove(ctx, id);
  }
}
