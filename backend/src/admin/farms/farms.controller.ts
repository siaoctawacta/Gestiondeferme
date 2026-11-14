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
import { Ctx, NoFarm, RequirePermission } from '../../access/decorators';
import type { RequestContext } from '../../access/decorators';
import { Audited } from '../../audit/audited.decorator';
import { ListQueryDto } from '../../listing/list-query.dto';
import { sendList } from '../shared';
import { CreateFarmDto, UpdateFarmDto } from './farms.dto';
import { FARM_COLUMNS, FarmsService } from './farms.service';

@ApiTags('farms')
@NoFarm()
@Controller('farms')
export class FarmsController {
  constructor(private readonly farms: FarmsService) {}

  @Get()
  @RequirePermission('fermes', 'read')
  async list(
    @Ctx() ctx: RequestContext,
    @Query() q: ListQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const { find, count } = this.farms.listArgs(ctx, q);
    await sendList(res, q, 'fermes', FARM_COLUMNS, find, count);
  }

  @Post()
  @RequirePermission('fermes', 'create')
  @Audited('fermes', { entity: FarmsService })
  create(@Ctx() ctx: RequestContext, @Body() dto: CreateFarmDto) {
    return this.farms.create(ctx, dto);
  }

  @Patch(':id')
  @RequirePermission('fermes', 'update')
  @Audited('fermes', { entity: FarmsService })
  update(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: UpdateFarmDto,
  ) {
    return this.farms.update(ctx, id, dto);
  }

  @Delete(':id')
  @RequirePermission('fermes', 'delete')
  @Audited('fermes', { entity: FarmsService })
  remove(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.farms.remove(ctx, id);
  }
}
