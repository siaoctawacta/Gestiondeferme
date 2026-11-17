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
import { Ctx, RequirePermission, RequireMaster } from '../access/decorators';
import type { RequestContext } from '../access/decorators';
import type { Response } from 'express';
import { sendList } from '../listing/list-helpers';
import {
  CandlingDto,
  CreateIncubationDto,
  FailDto,
  HatchDto,
  IncubationListQueryDto,
  UpdateIncubationDto,
} from './dto/incubation.dto';
import { INCUBATION_COLUMNS, IncubationsService } from './incubations.service';

@ApiTags('incubations')
@Controller('incubations')
export class IncubationsController {
  constructor(private readonly incubations: IncubationsService) {}

  @Get()
  @RequirePermission('ponte', 'read')
  async list(
    @Ctx() ctx: RequestContext,
    @Query() q: IncubationListQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const { find, count } = this.incubations.listArgs(ctx, q);
    await sendList(
      res,
      q,
      'incubations',
      INCUBATION_COLUMNS,
      find,
      count,
      async () => ({
        statusCounts: await this.incubations.statusCounts(ctx),
      }),
    );
  }

  @Post()
  @RequireMaster('ponte')
  create(@Ctx() ctx: RequestContext, @Body() dto: CreateIncubationDto) {
    return this.incubations.create(ctx, dto);
  }

  @Get(':id')
  @RequirePermission('ponte', 'read')
  get(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.incubations.get(ctx, id);
  }

  @Patch(':id')
  @RequireMaster('ponte')
  update(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: UpdateIncubationDto,
  ) {
    return this.incubations.update(ctx, id, dto);
  }

  @Delete(':id')
  @RequireMaster('ponte')
  async remove(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    await this.incubations.remove(ctx, id);
  }

  @Post(':id/candling')
  @HttpCode(200)
  @RequireMaster('ponte')
  candling(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: CandlingDto,
  ) {
    return this.incubations.candling(ctx, id, dto);
  }

  @Post(':id/hatch')
  @HttpCode(200)
  @RequireMaster('ponte')
  hatch(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: HatchDto,
  ) {
    return this.incubations.hatch(ctx, id, dto);
  }

  @Post(':id/fail')
  @HttpCode(200)
  @RequireMaster('ponte')
  fail(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: FailDto,
  ) {
    return this.incubations.fail(ctx, id, dto);
  }
}
