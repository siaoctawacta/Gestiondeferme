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
import { sendList } from '../../listing/list-helpers';
import { CreateZoneDto, UpdateZoneDto, ZonesQueryDto } from './zones.dto';
import { ZONE_COLUMNS, ZonesService } from './zones.service';

@ApiTags('zones')
@Controller('zones')
export class ZonesController {
  constructor(private readonly zones: ZonesService) {}

  @Get()
  @RequirePermission('batiments', 'read')
  async list(
    @Ctx() ctx: RequestContext,
    @Query() q: ZonesQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const { find, count } = this.zones.listArgs(ctx, q);
    await sendList(res, q, 'zones', ZONE_COLUMNS, find, count);
  }

  @Post()
  @RequirePermission('batiments', 'create')
  @Audited('batiments', { entity: ZonesService })
  create(@Ctx() ctx: RequestContext, @Body() dto: CreateZoneDto) {
    return this.zones.create(ctx, dto);
  }

  @Patch(':id')
  @RequirePermission('batiments', 'update')
  @Audited('batiments', { entity: ZonesService })
  update(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: UpdateZoneDto,
  ) {
    return this.zones.update(ctx, id, dto);
  }

  @Delete(':id')
  @RequirePermission('batiments', 'delete')
  @Audited('batiments', { entity: ZonesService })
  remove(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.zones.remove(ctx, id);
  }
}
