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
  CreateQuarantineDto,
  LiftQuarantineDto,
  QuarantineQueryDto,
  UpdateQuarantineDto,
} from './dto/quarantine.dto';
import { QuarantinesService } from './quarantines.service';

/** Daily entries of the `sante` module: `create` writes, edits and deletes. */
@ApiTags('quarantines')
@Controller('quarantines')
export class QuarantinesController {
  constructor(private readonly records: QuarantinesService) {}

  @Get()
  @RequirePermission('sante', 'read')
  list(@Ctx() ctx: RequestContext, @Query() q: QuarantineQueryDto) {
    const { find, count } = this.records.listArgs(ctx, q);
    return paginate(q, find, count);
  }

  @Post()
  @RequireDaily('sante')
  create(@Ctx() ctx: RequestContext, @Body() dto: CreateQuarantineDto) {
    return this.records.create(ctx, dto);
  }

  @Patch(':id')
  @RequireDaily('sante')
  update(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: UpdateQuarantineDto,
  ) {
    return this.records.update(ctx, id, dto);
  }

  @Delete(':id')
  @RequireDaily('sante')
  remove(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.records.remove(ctx, id);
  }

  @Post(':id/lift')
  @HttpCode(200)
  @RequireDaily('sante')
  lift(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: LiftQuarantineDto,
  ) {
    return this.records.lift(ctx, id, dto);
  }
}
