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
import { Ctx, RequirePermission } from '../access/decorators';
import type { RequestContext } from '../access/decorators';
import { paginate } from '../listing/paginate';
import {
  CandlingDto,
  CreateIncubationDto,
  FailDto,
  HatchDto,
  IncubationListQueryDto,
  UpdateIncubationDto,
} from './dto/incubation.dto';
import { IncubationsService } from './incubations.service';

@ApiTags('incubations')
@Controller('incubations')
export class IncubationsController {
  constructor(private readonly incubations: IncubationsService) {}

  @Get()
  @RequirePermission('ponte', 'read')
  list(@Ctx() ctx: RequestContext, @Query() q: IncubationListQueryDto) {
    const { find, count } = this.incubations.listArgs(ctx, q);
    return paginate(q, find, count);
  }

  @Post()
  @RequirePermission('ponte', 'create')
  create(@Ctx() ctx: RequestContext, @Body() dto: CreateIncubationDto) {
    return this.incubations.create(ctx, dto);
  }

  @Get(':id')
  @RequirePermission('ponte', 'read')
  get(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.incubations.get(ctx, id);
  }

  @Patch(':id')
  @RequirePermission('ponte', 'update')
  update(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: UpdateIncubationDto,
  ) {
    return this.incubations.update(ctx, id, dto);
  }

  @Delete(':id')
  @RequirePermission('ponte', 'delete')
  async remove(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    await this.incubations.remove(ctx, id);
  }

  @Post(':id/candling')
  @HttpCode(200)
  @RequirePermission('ponte', 'update')
  candling(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: CandlingDto,
  ) {
    return this.incubations.candling(ctx, id, dto);
  }

  @Post(':id/hatch')
  @HttpCode(200)
  @RequirePermission('ponte', 'update')
  hatch(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: HatchDto,
  ) {
    return this.incubations.hatch(ctx, id, dto);
  }

  @Post(':id/fail')
  @HttpCode(200)
  @RequirePermission('ponte', 'update')
  fail(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: FailDto,
  ) {
    return this.incubations.fail(ctx, id, dto);
  }
}
