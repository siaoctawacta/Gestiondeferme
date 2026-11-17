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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Ctx, RequireDaily, RequirePermission } from '../access/decorators';
import type { RequestContext } from '../access/decorators';
import { singleFileUpload, type UploadedBlob } from '../common/uploads';
import { sendList } from '../listing/list-helpers';
import {
  CompleteTaskDto,
  CreateTaskDto,
  TaskQueryDto,
  UpdateTaskDto,
} from './dto/task.dto';
import { taskColumns } from './task-view';
import { PROOF_INVALID, PROOF_MAX_BYTES, TasksService } from './tasks.service';

/**
 * Tasks are daily entries of `taches` (`create` writes them). Progress steps
 * and the proof photo need `update`, and the service limits a caller without
 * `create` to the tasks assigned to him. The fixed `proof` paths follow `:id`.
 */
@ApiTags('tasks')
@Controller('tasks')
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get()
  @RequirePermission('taches', 'read')
  async list(
    @Ctx() ctx: RequestContext,
    @Query() q: TaskQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const { find, count, statusCounts } = this.tasks.listArgs(ctx, q);
    await sendList(res, q, 'taches', taskColumns, find, count, statusCounts);
  }

  @Get(':id')
  @RequirePermission('taches', 'read')
  get(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.tasks.get(ctx, id);
  }

  @Post()
  @RequireDaily('taches')
  create(@Ctx() ctx: RequestContext, @Body() dto: CreateTaskDto) {
    return this.tasks.create(ctx, dto);
  }

  @Patch(':id')
  @RequireDaily('taches')
  update(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: UpdateTaskDto,
  ) {
    return this.tasks.update(ctx, id, dto);
  }

  @Delete(':id')
  @RequireDaily('taches')
  remove(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.tasks.remove(ctx, id);
  }

  @Post(':id/start')
  @HttpCode(200)
  @RequirePermission('taches', 'update')
  start(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.tasks.start(ctx, id);
  }

  @Post(':id/complete')
  @HttpCode(200)
  @RequirePermission('taches', 'update')
  complete(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: CompleteTaskDto,
  ) {
    return this.tasks.complete(ctx, id, dto);
  }

  @Post(':id/reopen')
  @HttpCode(200)
  @RequirePermission('taches', 'update')
  reopen(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.tasks.reopen(ctx, id);
  }

  @Post(':id/proof')
  @RequirePermission('taches', 'update')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(singleFileUpload('file', PROOF_MAX_BYTES, PROOF_INVALID))
  setProof(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @UploadedFile() file: UploadedBlob | undefined,
  ) {
    return this.tasks.setProof(ctx, id, file);
  }

  /** The photo itself, for the readers of the tasks of the farm (never cached by shared caches). */
  @Get(':id/proof')
  @RequirePermission('taches', 'read')
  async proof(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Res() res: Response,
  ): Promise<void> {
    const { bytes, mime } = await this.tasks.readProof(ctx, id);
    res
      .status(200)
      .setHeader('Content-Type', mime)
      .setHeader('Cache-Control', 'private, no-store')
      .setHeader('Content-Disposition', 'inline')
      .end(bytes);
  }

  @Delete(':id/proof')
  @RequirePermission('taches', 'update')
  clearProof(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.tasks.clearProof(ctx, id);
  }
}
