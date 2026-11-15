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
import { AccessService } from '../access/access.service';
import { AnyAuthenticated, Ctx } from '../access/decorators';
import type { RequestContext } from '../access/decorators';
import { formatDayOrNull } from '../common/days';
import { sendList } from '../listing/list-helpers';
import { ListQueryDto } from '../listing/list-query.dto';
import { BatchPerformanceRegistry } from './batch-performance';
import { BatchEventsService } from './batch-events.service';
import { BATCH_COLUMNS, BatchesService } from './batches.service';
import {
  BatchListQueryDto,
  CreateBatchDto,
  UpdateBatchDto,
} from './dto/batch.dto';
import { CreateEventDto, TransferDto, UpdateEventDto } from './dto/event.dto';
import { speciesModule } from './species';
import { WithdrawalRegistry } from './withdrawal';

/**
 * Poultry batches fall under `lots`, pig batches under `porcs`, so the module
 * is not static: each handler resolves the species, then checks it explicitly.
 */
@ApiTags('batches')
@Controller('batches')
export class BatchesController {
  constructor(
    private readonly batches: BatchesService,
    private readonly events: BatchEventsService,
    private readonly access: AccessService,
    private readonly performance: BatchPerformanceRegistry,
    private readonly withdrawal: WithdrawalRegistry,
  ) {}

  /**
   * Loads the batch's species (404 when out of scope), then checks the
   * permission for it: `read`, `master` (lots as master data) or `daily`
   * (entries on a lot), see `MASTER_WRITE` / `DAILY_WRITE`.
   */
  private async guard(
    ctx: RequestContext,
    id: string,
    kind: 'read' | 'master' | 'daily',
  ) {
    const species = await this.batches.speciesOf(ctx, id);
    const module = speciesModule(species);
    if (kind === 'master') this.access.assertMaster(ctx, module);
    else if (kind === 'daily') this.access.assertDaily(ctx, module);
    else this.access.assertCan(ctx, module, 'read');
  }

  @Get()
  @AnyAuthenticated()
  async list(
    @Ctx() ctx: RequestContext,
    @Query() q: BatchListQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    this.access.assertCan(ctx, speciesModule(q.species), 'read');
    const { find, count } = this.batches.listArgs(ctx, q);
    await sendList(
      res,
      q,
      q.species === 'AVICOLE' ? 'lots-avicoles' : 'lots-porcins',
      BATCH_COLUMNS,
      find,
      count,
      async () => ({
        statusCounts: await this.batches.statusCounts(ctx, q.species),
      }),
    );
  }

  @Post()
  @AnyAuthenticated()
  async create(@Ctx() ctx: RequestContext, @Body() dto: CreateBatchDto) {
    this.access.assertMaster(ctx, speciesModule(dto.species));
    // Same shape as the detail: a new lot has no withdrawal period.
    return { ...(await this.batches.create(ctx, dto)), withdrawalUntil: null };
  }

  @Get(':id')
  @AnyAuthenticated()
  async get(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    await this.guard(ctx, id, 'read');
    const batch = await this.batches.get(ctx, id);
    return {
      ...batch,
      performance: await this.performance.get(ctx, id),
      // Last day (inclusive) under a withdrawal period, whatever it is today.
      withdrawalUntil: formatDayOrNull(
        await this.withdrawal.until({ batchId: id }),
      ),
    };
  }

  @Patch(':id')
  @AnyAuthenticated()
  async update(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: UpdateBatchDto,
  ) {
    await this.guard(ctx, id, 'master');
    return this.batches.update(ctx, id, dto);
  }

  @Delete(':id')
  @AnyAuthenticated()
  async remove(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    await this.guard(ctx, id, 'master');
    await this.batches.remove(ctx, id);
  }

  @Post(':id/close')
  @HttpCode(200)
  @AnyAuthenticated()
  async close(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    await this.guard(ctx, id, 'master');
    return this.batches.close(ctx, id);
  }

  @Post(':id/reopen')
  @HttpCode(200)
  @AnyAuthenticated()
  async reopen(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    await this.guard(ctx, id, 'master');
    return this.batches.reopen(ctx, id);
  }

  @Post(':id/transfer')
  @HttpCode(200)
  @AnyAuthenticated()
  async transfer(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: TransferDto,
  ) {
    await this.guard(ctx, id, 'master');
    return this.events.transfer(ctx, id, dto);
  }

  @Get(':id/events')
  @AnyAuthenticated()
  async listEvents(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Query() q: ListQueryDto,
  ) {
    await this.guard(ctx, id, 'read');
    return this.events.list(ctx, id, q);
  }

  @Post(':id/events')
  @AnyAuthenticated()
  async createEvent(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: CreateEventDto,
  ) {
    await this.guard(ctx, id, 'daily');
    return this.events.create(ctx, id, dto);
  }

  @Patch(':id/events/:eventId')
  @AnyAuthenticated()
  async updateEvent(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Param('eventId') eventId: string,
    @Body() dto: UpdateEventDto,
  ) {
    await this.guard(ctx, id, 'daily');
    return this.events.update(ctx, id, eventId, dto);
  }

  @Delete(':id/events/:eventId')
  @AnyAuthenticated()
  async removeEvent(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Param('eventId') eventId: string,
  ) {
    await this.guard(ctx, id, 'daily');
    await this.events.remove(ctx, id, eventId);
  }
}
