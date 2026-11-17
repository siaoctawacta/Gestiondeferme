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
import { Ctx, RequireMaster, RequirePermission } from '../access/decorators';
import type { RequestContext } from '../access/decorators';
import { sendList } from '../listing/list-helpers';
import {
  CreateMaintenanceDto,
  MaintenanceQueryDto,
  UpdateMaintenanceDto,
} from './dto/equipment.dto';
import { maintenanceColumns } from './equipment-view';
import { MaintenanceService } from './maintenance.service';

/** Interventions on equipment: master data of `equipements` (`update` writes). */
@ApiTags('maintenance')
@Controller('maintenance')
export class MaintenanceController {
  constructor(private readonly maintenance: MaintenanceService) {}

  @Get()
  @RequirePermission('equipements', 'read')
  async list(
    @Ctx() ctx: RequestContext,
    @Query() q: MaintenanceQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const { find, count, withCost } = this.maintenance.listArgs(ctx, q);
    await sendList(
      res,
      q,
      'interventions',
      maintenanceColumns(withCost),
      find,
      count,
    );
  }

  @Post()
  @RequireMaster('equipements')
  create(@Ctx() ctx: RequestContext, @Body() dto: CreateMaintenanceDto) {
    return this.maintenance.create(ctx, dto);
  }

  @Patch(':id')
  @RequireMaster('equipements')
  update(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: UpdateMaintenanceDto,
  ) {
    return this.maintenance.update(ctx, id, dto);
  }

  @Delete(':id')
  @RequireMaster('equipements')
  remove(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.maintenance.remove(ctx, id);
  }
}
