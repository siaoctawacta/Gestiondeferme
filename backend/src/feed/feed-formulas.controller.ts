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
import {
  Ctx,
  NoFarm,
  RequirePermission,
  RequireMaster,
} from '../access/decorators';
import type { RequestContext } from '../access/decorators';
import { sendList } from '../listing/list-helpers';
import {
  CreateFeedFormulaDto,
  FeedFormulaQueryDto,
  UpdateFeedFormulaDto,
} from './dto/feed-formula.dto';
import {
  FEED_FORMULA_COLUMNS,
  FeedFormulasService,
} from './feed-formulas.service';

/** Formulas are shared by every farm of the organisation. */
@ApiTags('feed-formulas')
@Controller('feed-formulas')
@NoFarm()
export class FeedFormulasController {
  constructor(private readonly formulas: FeedFormulasService) {}

  @Get()
  @RequirePermission('alimentation', 'read')
  async list(
    @Ctx() ctx: RequestContext,
    @Query() q: FeedFormulaQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const { find, count } = this.formulas.listArgs(ctx, q);
    await sendList(res, q, 'formules', FEED_FORMULA_COLUMNS, find, count);
  }

  @Post()
  @RequireMaster('alimentation')
  create(@Ctx() ctx: RequestContext, @Body() dto: CreateFeedFormulaDto) {
    return this.formulas.create(ctx, dto);
  }

  @Patch(':id')
  @RequireMaster('alimentation')
  update(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: UpdateFeedFormulaDto,
  ) {
    return this.formulas.update(ctx, id, dto);
  }

  @Delete(':id')
  @RequireMaster('alimentation')
  remove(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.formulas.remove(ctx, id);
  }
}
