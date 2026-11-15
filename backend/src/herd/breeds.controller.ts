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
import { AccessService } from '../access/access.service';
import { AnyAuthenticated, Ctx } from '../access/decorators';
import type { RequestContext } from '../access/decorators';
import { can } from '../access/permissions';
import { BreedsService } from './breeds.service';
import { BreedQueryDto, CreateBreedDto, UpdateBreedDto } from './dto/breed.dto';
import { speciesModule } from './species';

/**
 * Breeds serve poultry and pigs alike: readable by whoever reads either module.
 * They are master data, so a write needs `update` on the module of the breed's
 * species (`lots` for AVICOLE, `porcs` for PORCIN).
 */
@ApiTags('breeds')
@Controller('breeds')
export class BreedsController {
  constructor(
    private readonly breeds: BreedsService,
    private readonly access: AccessService,
  ) {}

  private assertAnyRead(ctx: RequestContext): void {
    const role = ctx.user.role;
    if (!can(role, 'lots', 'read') && !can(role, 'porcs', 'read')) {
      throw new ForbiddenException('Permission insuffisante');
    }
  }

  @Get()
  @AnyAuthenticated()
  list(@Ctx() ctx: RequestContext, @Query() q: BreedQueryDto) {
    this.assertAnyRead(ctx);
    return this.breeds.list(ctx, q.species);
  }

  @Post()
  @AnyAuthenticated()
  create(@Ctx() ctx: RequestContext, @Body() dto: CreateBreedDto) {
    this.access.assertMaster(ctx, speciesModule(dto.species));
    return this.breeds.create(ctx, dto);
  }

  @Patch(':id')
  @AnyAuthenticated()
  async update(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: UpdateBreedDto,
  ) {
    this.access.assertMaster(
      ctx,
      speciesModule(await this.breeds.speciesOf(ctx, id)),
    );
    return this.breeds.update(ctx, id, dto);
  }

  @Delete(':id')
  @AnyAuthenticated()
  async remove(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    this.access.assertMaster(
      ctx,
      speciesModule(await this.breeds.speciesOf(ctx, id)),
    );
    return this.breeds.remove(ctx, id);
  }
}
