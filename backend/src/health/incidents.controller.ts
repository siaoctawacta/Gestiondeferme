import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Ctx, RequireDaily, RequirePermission } from '../access/decorators';
import type { RequestContext } from '../access/decorators';
import { paginate } from '../listing/paginate';
import {
  CreateIncidentDto,
  IncidentQueryDto,
  UpdateIncidentDto,
} from './dto/incident.dto';
import { IncidentsService } from './incidents.service';

/** Daily entries of the `sante` module: `create` writes, edits and deletes. */
@ApiTags('incidents')
@Controller('incidents')
export class IncidentsController {
  constructor(private readonly records: IncidentsService) {}

  @Get()
  @RequirePermission('sante', 'read')
  list(@Ctx() ctx: RequestContext, @Query() q: IncidentQueryDto) {
    const { find, count } = this.records.listArgs(ctx, q);
    return paginate(q, find, count);
  }

  @Post()
  @RequireDaily('sante')
  create(@Ctx() ctx: RequestContext, @Body() dto: CreateIncidentDto) {
    return this.records.create(ctx, dto);
  }

  @Patch(':id')
  @RequireDaily('sante')
  update(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: UpdateIncidentDto,
  ) {
    return this.records.update(ctx, id, dto);
  }

  @Delete(':id')
  @RequireDaily('sante')
  remove(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.records.remove(ctx, id);
  }

  @Post(':id/close')
  @HttpCode(200)
  @RequireDaily('sante')
  close(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.records.close(ctx, id);
  }
}
