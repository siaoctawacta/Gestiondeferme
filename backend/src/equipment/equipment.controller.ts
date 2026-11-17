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
import {
  Ctx,
  RequireDaily,
  RequireMaster,
  RequirePermission,
} from '../access/decorators';
import type { RequestContext } from '../access/decorators';
import { sendList } from '../listing/list-helpers';
import {
  BreakdownDto,
  CreateEquipmentDto,
  EquipmentQueryDto,
  RetireDto,
  UpdateEquipmentDto,
} from './dto/equipment.dto';
import { equipmentColumns } from './equipment-view';
import { EquipmentService } from './equipment.service';

/**
 * Equipment is master data of `equipements` (`update` writes, retirement and
 * reinstatement included); declaring a breakdown is a daily entry (`create`).
 */
@ApiTags('equipment')
@Controller('equipment')
export class EquipmentController {
  constructor(private readonly equipment: EquipmentService) {}

  @Get()
  @RequirePermission('equipements', 'read')
  async list(
    @Ctx() ctx: RequestContext,
    @Query() q: EquipmentQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const { find, count, statusCounts } = this.equipment.listArgs(ctx, q);
    await sendList(
      res,
      q,
      'equipements',
      equipmentColumns,
      find,
      count,
      statusCounts,
    );
  }

  @Get(':id')
  @RequirePermission('equipements', 'read')
  get(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.equipment.get(ctx, id);
  }

  @Post()
  @RequireMaster('equipements')
  create(@Ctx() ctx: RequestContext, @Body() dto: CreateEquipmentDto) {
    return this.equipment.create(ctx, dto);
  }

  @Patch(':id')
  @RequireMaster('equipements')
  update(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: UpdateEquipmentDto,
  ) {
    return this.equipment.update(ctx, id, dto);
  }

  @Delete(':id')
  @RequireMaster('equipements')
  remove(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.equipment.remove(ctx, id);
  }

  @Post(':id/retire')
  @HttpCode(200)
  @RequireMaster('equipements')
  retire(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: RetireDto,
  ) {
    return this.equipment.retire(ctx, id, dto);
  }

  @Post(':id/reinstate')
  @HttpCode(200)
  @RequireMaster('equipements')
  reinstate(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.equipment.reinstate(ctx, id);
  }

  @Post(':id/breakdowns')
  @RequireDaily('equipements')
  declare(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: BreakdownDto,
  ) {
    return this.equipment.declareBreakdown(ctx, id, dto);
  }
}
