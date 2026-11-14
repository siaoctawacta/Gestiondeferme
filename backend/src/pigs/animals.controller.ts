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
import { ListQueryDto } from '../listing/list-query.dto';
import { paginate } from '../listing/paginate';
import { AnimalsService } from './animals.service';
import {
  AnimalListQueryDto,
  CreateAnimalDto,
  CreateAnimalWeighingDto,
  ExitAnimalDto,
  UpdateAnimalDto,
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
  @RequirePermission('porcs', 'create')
  create(@Ctx() ctx: RequestContext, @Body() dto: CreateAnimalDto) {
    return this.animals.create(ctx, dto);
  }

  @Get(':id')
  @RequirePermission('porcs', 'read')
  get(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.animals.get(ctx, id);
  }

  @Patch(':id')
  @RequirePermission('porcs', 'update')
  update(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: UpdateAnimalDto,
  ) {
    return this.animals.update(ctx, id, dto);
  }

  @Delete(':id')
  @RequirePermission('porcs', 'delete')
  async remove(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    await this.animals.remove(ctx, id);
  }

  @Post(':id/exit')
  @HttpCode(200)
  @RequirePermission('porcs', 'update')
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
  @RequirePermission('porcs', 'create')
  createWeighing(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: CreateAnimalWeighingDto,
  ) {
    return this.animals.createWeighing(ctx, id, dto);
  }
}
