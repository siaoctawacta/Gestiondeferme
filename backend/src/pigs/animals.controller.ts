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
import {
  Ctx,
  RequireDaily,
  RequireMaster,
  RequirePermission,
} from '../access/decorators';
import type { RequestContext } from '../access/decorators';
import { ListQueryDto } from '../listing/list-query.dto';
import { paginate } from '../listing/paginate';
import { AnimalsService } from './animals.service';
import {
  AnimalListQueryDto,
  CreateAnimalDto,
  CreateAnimalWeighingDto,
  ExitAnimalDto,
  UpdateAnimalDto,
  UpdateAnimalWeighingDto,
} from './dto/animal.dto';

@ApiTags('animals')
@Controller('animals')
export class AnimalsController {
  constructor(private readonly animals: AnimalsService) {}

  @Get()
  @RequirePermission('porcs', 'read')
  list(@Ctx() ctx: RequestContext, @Query() q: AnimalListQueryDto) {
    const { find, count } = this.animals.listArgs(ctx, q);
    return paginate(q, find, count);
  }

  @Post()
  @RequireMaster('porcs')
  create(@Ctx() ctx: RequestContext, @Body() dto: CreateAnimalDto) {
    return this.animals.create(ctx, dto);
  }

  @Get(':id')
  @RequirePermission('porcs', 'read')
  get(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.animals.get(ctx, id);
  }

  @Patch(':id')
  @RequireMaster('porcs')
  update(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: UpdateAnimalDto,
  ) {
    return this.animals.update(ctx, id, dto);
  }

  @Delete(':id')
  @RequireMaster('porcs')
  async remove(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    await this.animals.remove(ctx, id);
  }

  @Post(':id/exit')
  @HttpCode(200)
  @RequireMaster('porcs')
  exit(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: ExitAnimalDto,
  ) {
    return this.animals.exit(ctx, id, dto);
  }

  @Get(':id/weighings')
  @RequirePermission('porcs', 'read')
  listWeighings(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Query() q: ListQueryDto,
  ) {
    return this.animals.listWeighings(ctx, id, q);
  }

  @Post(':id/weighings')
  @RequireDaily('porcs')
  createWeighing(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: CreateAnimalWeighingDto,
  ) {
    return this.animals.createWeighing(ctx, id, dto);
  }

  @Patch(':id/weighings/:weighingId')
  @RequireDaily('porcs')
  updateWeighing(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Param('weighingId') weighingId: string,
    @Body() dto: UpdateAnimalWeighingDto,
  ) {
    return this.animals.updateWeighing(ctx, id, weighingId, dto);
  }

  @Delete(':id/weighings/:weighingId')
  @RequireDaily('porcs')
  async removeWeighing(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Param('weighingId') weighingId: string,
  ) {
    await this.animals.removeWeighing(ctx, id, weighingId);
  }

  @Post(':id/reinstate')
  @HttpCode(200)
  @RequireMaster('porcs')
  reinstate(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.animals.reinstate(ctx, id);
  }
}
