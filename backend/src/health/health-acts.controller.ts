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
import type { Response } from 'express';
import { Ctx, RequireDaily, RequirePermission } from '../access/decorators';
import type { RequestContext } from '../access/decorators';
import { sendList } from '../listing/list-helpers';
import {
  CompleteHealthActDto,
  CreateHealthActDto,
  HealthActQueryDto,
  UpdateHealthActDto,
} from './dto/health-act.dto';
import { ACT_COLUMNS } from './health-act-view';
import { HealthActsService } from './health-acts.service';

/**
 * Acts are daily entries: whoever may create one (`create` on `sante`) also
 * edits, completes, cancels and deletes it. A done act with a stock article
 * consumes stock on its own, even for a role with no `stocks` rights.
 */
@ApiTags('health-acts')
@Controller('health-acts')
export class HealthActsController {
  constructor(private readonly acts: HealthActsService) {}

  @Get()
  @RequirePermission('sante', 'read')
  async list(
    @Ctx() ctx: RequestContext,
    @Query() q: HealthActQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const { find, count, statusCounts } = this.acts.listArgs(ctx, q);
    await sendList(
      res,
      q,
      'sante-interventions',
      ACT_COLUMNS,
      find,
      count,
      async () => ({
        statusCounts: await statusCounts(),
      }),
    );
  }

  @Post()
  @RequireDaily('sante')
  create(@Ctx() ctx: RequestContext, @Body() dto: CreateHealthActDto) {
    return this.acts.create(ctx, dto);
  }

  @Patch(':id')
  @RequireDaily('sante')
  update(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: UpdateHealthActDto,
  ) {
    return this.acts.update(ctx, id, dto);
  }

  @Delete(':id')
  @RequireDaily('sante')
  remove(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.acts.remove(ctx, id);
  }

  @Post(':id/complete')
  @HttpCode(200)
  @RequireDaily('sante')
  complete(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: CompleteHealthActDto,
  ) {
    return this.acts.complete(ctx, id, dto);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequireDaily('sante')
  cancel(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.acts.cancel(ctx, id);
  }
}
