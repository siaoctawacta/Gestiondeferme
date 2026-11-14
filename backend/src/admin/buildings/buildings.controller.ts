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
import { Ctx, RequirePermission } from '../../access/decorators';
import type { RequestContext } from '../../access/decorators';
import { Audited } from '../../audit/audited.decorator';
import { ListQueryDto } from '../../listing/list-query.dto';
import { sendList } from '../../listing/list-helpers';
import { CreateBuildingDto, UpdateBuildingDto } from './buildings.dto';
import { BUILDING_COLUMNS, BuildingsService } from './buildings.service';

@ApiTags('buildings')
@Controller('buildings')
export class BuildingsController {
  constructor(private readonly buildings: BuildingsService) {}

  @Get()
  @RequirePermission('batiments', 'read')
  async list(
    @Ctx() ctx: RequestContext,
    @Query() q: ListQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const { find, count } = this.buildings.listArgs(ctx, q);
    await sendList(
      res,
      q,
      'batiments',
      BUILDING_COLUMNS,
      find,
      count,
      async () => ({
        statusCounts: await this.buildings.statusCounts(ctx),
      }),
    );
  }

  @Get(':id')
  @RequirePermission('batiments', 'read')
  get(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.buildings.get(ctx, id);
  }

  @Post()
  @RequirePermission('batiments', 'create')
  @Audited('batiments', { entity: BuildingsService })
  create(@Ctx() ctx: RequestContext, @Body() dto: CreateBuildingDto) {
    return this.buildings.create(ctx, dto);
  }

  @Patch(':id')
  @RequirePermission('batiments', 'update')
  @Audited('batiments', { entity: BuildingsService })
  update(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: UpdateBuildingDto,
  ) {
    return this.buildings.update(ctx, id, dto);
  }

  @Delete(':id')
  @RequirePermission('batiments', 'delete')
  @Audited('batiments', { entity: BuildingsService })
  remove(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.buildings.remove(ctx, id);
  }
}
