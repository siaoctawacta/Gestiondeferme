import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AnyAuthenticated, Ctx } from '../access/decorators';
import type { RequestContext } from '../access/decorators';
import { can } from '../access/permissions';
import { Audited } from '../audit/audited.decorator';
import { BreedsService } from './breeds.service';
import { BreedQueryDto, CreateBreedDto, UpdateBreedDto } from './dto/breed.dto';

/** Breeds serve poultry and pigs alike: readable by whoever reads either module, writable by whoever creates in either. */
@ApiTags('breeds')
@Controller('breeds')
export class BreedsController {
  constructor(private readonly breeds: BreedsService) {}

  private assertAny(ctx: RequestContext, action: 'read' | 'create'): void {
    const role = ctx.user.role;
    if (!can(role, 'lots', action) && !can(role, 'porcs', action)) {
      throw new ForbiddenException('Permission insuffisante');
    }
  }

  @Get()
  @AnyAuthenticated()
  list(@Ctx() ctx: RequestContext, @Query() q: BreedQueryDto) {
    this.assertAny(ctx, 'read');
    return this.breeds.list(ctx, q.species);
  }

  @Post()
  @AnyAuthenticated()
  @Audited('lots', { entity: BreedsService })
  create(@Ctx() ctx: RequestContext, @Body() dto: CreateBreedDto) {
    this.assertAny(ctx, 'create');
    return this.breeds.create(ctx, dto);
  }

  @Patch(':id')
  @AnyAuthenticated()
  @Audited('lots', { entity: BreedsService })
  update(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: UpdateBreedDto,
  ) {
    this.assertAny(ctx, 'create');
    return this.breeds.update(ctx, id, dto);
  }

  @Delete(':id')
  @AnyAuthenticated()
  @Audited('lots', { entity: BreedsService })
  remove(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    this.assertAny(ctx, 'create');
    return this.breeds.remove(ctx, id);
  }
}
