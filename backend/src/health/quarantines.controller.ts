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
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Ctx, RequireDaily, RequirePermission } from '../access/decorators';
import type { RequestContext } from '../access/decorators';
import type { Response } from 'express';
import { sendList } from '../listing/list-helpers';
import {
  CreateQuarantineDto,
  LiftQuarantineDto,
  QuarantineQueryDto,
  UpdateQuarantineDto,
} from './dto/quarantine.dto';
import { QUARANTINE_COLUMNS, QuarantinesService } from './quarantines.service';

/** Daily entries of the `sante` module: `create` writes, edits and deletes. */
@ApiTags('quarantines')
@Controller('quarantines')
export class QuarantinesController {
  constructor(private readonly records: QuarantinesService) {}

  @Get()
  @RequirePermission('sante', 'read')
  async list(
    @Ctx() ctx: RequestContext,
    @Query() q: QuarantineQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const { find, count, statusCounts } = this.records.listArgs(ctx, q);
    await sendList(
      res,
      q,
      'quarantaines',
      QUARANTINE_COLUMNS,
      find,
      count,
      async () => ({
        statusCounts: await statusCounts(),
      }),
    );
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
