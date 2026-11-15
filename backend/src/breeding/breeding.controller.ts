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
import { ListQueryDto } from '../listing/list-query.dto';
import { BREEDING_COLUMNS, BreedingService } from './breeding.service';
import {
  BreedingListQueryDto,
  CreateBreedingDto,
  CreateHeatDto,
  FailBreedingDto,
  FarrowingDto,
  UpdateBreedingDto,
  UpdateHeatDto,
  WeaningDto,
} from './dto/breeding.dto';
import { HeatsService } from './heats.service';

@ApiTags('breeding')
@Controller('breeding')
export class BreedingController {
  constructor(private readonly breeding: BreedingService) {}

  @Get()
  @RequirePermission('reproduction', 'read')
  async list(
    @Ctx() ctx: RequestContext,
    @Query() q: BreedingListQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const { find, count } = this.breeding.listArgs(ctx, q);
    await sendList(
      res,
      q,
      'reproduction',
      BREEDING_COLUMNS,
      find,
      count,
      async () => ({
        statusCounts: await this.breeding.statusCounts(ctx),
      }),
    );
  }

  @Post()
  @RequireMaster('reproduction')
  create(@Ctx() ctx: RequestContext, @Body() dto: CreateBreedingDto) {
    return this.breeding.create(ctx, dto);
  }

  @Patch(':id')
  @RequireMaster('reproduction')
  update(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: UpdateBreedingDto,
  ) {
    return this.breeding.update(ctx, id, dto);
  }

  @Delete(':id')
  @RequireMaster('reproduction')
  async remove(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    await this.breeding.remove(ctx, id);
  }

  @Post(':id/farrowing')
  @HttpCode(200)
  @RequireMaster('reproduction')
  farrowing(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: FarrowingDto,
  ) {
    return this.breeding.farrowing(ctx, id, dto);
  }

  @Post(':id/weaning')
  @HttpCode(200)
  @RequireMaster('reproduction')
  weaning(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: WeaningDto,
  ) {
    return this.breeding.weaning(ctx, id, dto);
  }

  @Post(':id/fail')
  @HttpCode(200)
  @RequireMaster('reproduction')
  fail(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: FailBreedingDto,
  ) {
    return this.breeding.fail(ctx, id, dto);
  }
}

/** Heats and breeding history hang off an animal but belong to the `reproduction` module. */
@ApiTags('breeding')
@Controller('animals/:id')
export class AnimalReproductionController {
  constructor(
    private readonly breeding: BreedingService,
    private readonly heats: HeatsService,
  ) {}

  @Get('heats')
  @RequirePermission('reproduction', 'read')
  listHeats(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Query() q: ListQueryDto,
  ) {
    return this.heats.list(ctx, id, q);
  }

  @Post('heats')
  @RequireDaily('reproduction')
  createHeat(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: CreateHeatDto,
  ) {
    return this.heats.create(ctx, id, dto);
  }

  @Patch('heats/:heatId')
  @RequireDaily('reproduction')
  updateHeat(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Param('heatId') heatId: string,
    @Body() dto: UpdateHeatDto,
  ) {
    return this.heats.update(ctx, id, heatId, dto);
  }

  @Delete('heats/:heatId')
  @RequireDaily('reproduction')
  async removeHeat(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Param('heatId') heatId: string,
  ) {
    await this.heats.remove(ctx, id, heatId);
  }

  @Get('breeding-history')
  @RequirePermission('reproduction', 'read')
  history(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.breeding.history(ctx, id);
  }
}
