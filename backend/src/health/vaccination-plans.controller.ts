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
import {
  Ctx,
  NoFarm,
  RequireMaster,
  RequirePermission,
} from '../access/decorators';
import type { RequestContext } from '../access/decorators';
import type { Response } from 'express';
import { sendList } from '../listing/list-helpers';
import {
  ApplyPlanDto,
  CreatePlanDto,
  PlanQueryDto,
  UpdatePlanDto,
} from './dto/vaccination-plan.dto';
import {
  PLAN_COLUMNS,
  VaccinationPlansService,
} from './vaccination-plans.service';

/**
 * Plans are organisation master data (`update` on `sante`, whatever the verb),
 * written under any farm header, `all` included. `apply` stamps acts on one
 * farm's lot, so it is farm-scoped and refused under `all`.
 */
@ApiTags('vaccination-plans')
@Controller('vaccination-plans')
export class VaccinationPlansController {
  constructor(private readonly plans: VaccinationPlansService) {}

  @Get()
  @NoFarm()
  @RequirePermission('sante', 'read')
  async list(
    @Ctx() ctx: RequestContext,
    @Query() q: PlanQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const { find, count } = this.plans.listArgs(ctx, q);
    await sendList(res, q, 'plans-vaccinaux', PLAN_COLUMNS, find, count);
  }

  @Post()
  @NoFarm()
  @RequireMaster('sante')
  create(@Ctx() ctx: RequestContext, @Body() dto: CreatePlanDto) {
    return this.plans.create(ctx, dto);
  }

  @Patch(':id')
  @NoFarm()
  @RequireMaster('sante')
  update(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: UpdatePlanDto,
  ) {
    return this.plans.update(ctx, id, dto);
  }

  @Delete(':id')
  @NoFarm()
  @RequireMaster('sante')
  remove(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.plans.remove(ctx, id);
  }

  @Post(':id/apply')
  @RequireMaster('sante')
  apply(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: ApplyPlanDto,
  ) {
    return this.plans.apply(ctx, id, dto);
  }
}
