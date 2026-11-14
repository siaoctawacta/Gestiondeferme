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
import { SiteDto } from './sites.dto';
import { SITE_COLUMNS, SitesService } from './sites.service';

@ApiTags('sites')
@Controller('sites')
export class SitesController {
  constructor(private readonly sites: SitesService) {}

  @Get()
  @RequirePermission('batiments', 'read')
  async list(
    @Ctx() ctx: RequestContext,
    @Query() q: ListQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const { find, count } = this.sites.listArgs(ctx, q);
    await sendList(res, q, 'sites', SITE_COLUMNS, find, count);
  }

  @Post()
  @RequirePermission('batiments', 'create')
  @Audited('batiments', { entity: SitesService })
  create(@Ctx() ctx: RequestContext, @Body() dto: SiteDto) {
    return this.sites.create(ctx, dto);
  }

  @Patch(':id')
  @RequirePermission('batiments', 'update')
  @Audited('batiments', { entity: SitesService })
  update(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: SiteDto,
  ) {
    return this.sites.update(ctx, id, dto);
  }

  @Delete(':id')
  @RequirePermission('batiments', 'delete')
  @Audited('batiments', { entity: SitesService })
  remove(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.sites.remove(ctx, id);
  }
}
