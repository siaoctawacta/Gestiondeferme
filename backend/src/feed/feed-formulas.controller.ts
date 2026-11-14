import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Ctx, NoFarm, RequirePermission } from '../access/decorators';
import type { RequestContext } from '../access/decorators';
import {
  CreateFeedFormulaDto,
  FeedFormulaQueryDto,
  UpdateFeedFormulaDto,
} from './dto/feed-formula.dto';
import { FeedFormulasService } from './feed-formulas.service';

/** Formulas are shared by every farm of the organisation. */
@ApiTags('feed-formulas')
@Controller('feed-formulas')
@NoFarm()
export class FeedFormulasController {
  constructor(private readonly formulas: FeedFormulasService) {}

  @Get()
  @RequirePermission('alimentation', 'read')
  list(@Ctx() ctx: RequestContext, @Query() q: FeedFormulaQueryDto) {
    return this.formulas.list(ctx, q);
  }

  @Post()
  @RequirePermission('alimentation', 'create')
  create(@Ctx() ctx: RequestContext, @Body() dto: CreateFeedFormulaDto) {
    return this.formulas.create(ctx, dto);
  }

  @Patch(':id')
  @RequirePermission('alimentation', 'update')
  update(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: UpdateFeedFormulaDto,
  ) {
    return this.formulas.update(ctx, id, dto);
  }

  @Delete(':id')
  @RequirePermission('alimentation', 'delete')
  remove(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.formulas.remove(ctx, id);
  }
}
