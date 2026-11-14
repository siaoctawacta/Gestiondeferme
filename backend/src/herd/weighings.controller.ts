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
import { AccessService } from '../access/access.service';
import { AnyAuthenticated, Ctx } from '../access/decorators';
import type { RequestContext } from '../access/decorators';
import type { Action } from '../access/permissions';
import { ListQueryDto } from '../listing/list-query.dto';
import { BatchesService } from './batches.service';
import { CreateWeighingDto, UpdateWeighingDto } from './dto/weighing.dto';
import { speciesModule } from './species';
import { WeighingsService } from './weighings.service';

@ApiTags('batches')
@Controller('batches/:id/weighings')
export class WeighingsController {
  constructor(
    private readonly weighings: WeighingsService,
    private readonly batches: BatchesService,
    private readonly access: AccessService,
  ) {}

  private async guard(ctx: RequestContext, id: string, action: Action) {
    const species = await this.batches.speciesOf(ctx, id);
    this.access.assertCan(ctx, speciesModule(species), action);
  }

  @Get()
  @AnyAuthenticated()
  async list(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Query() q: ListQueryDto,
  ) {
    await this.guard(ctx, id, 'read');
    return this.weighings.list(ctx, id, q);
  }

  @Post()
  @AnyAuthenticated()
  async create(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: CreateWeighingDto,
  ) {
    await this.guard(ctx, id, 'create');
    return this.weighings.create(ctx, id, dto);
  }

  @Patch(':weighingId')
  @AnyAuthenticated()
  async update(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Param('weighingId') weighingId: string,
    @Body() dto: UpdateWeighingDto,
  ) {
    await this.guard(ctx, id, 'update');
    return this.weighings.update(ctx, id, weighingId, dto);
  }

  @Delete(':weighingId')
  @AnyAuthenticated()
  async remove(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Param('weighingId') weighingId: string,
  ) {
    await this.guard(ctx, id, 'delete');
    await this.weighings.remove(ctx, id, weighingId);
  }
}
