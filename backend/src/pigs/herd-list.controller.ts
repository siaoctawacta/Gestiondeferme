import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Ctx, RequirePermission } from '../access/decorators';
import type { RequestContext } from '../access/decorators';
import { sendList } from '../listing/list-helpers';
import { HerdListQueryDto } from './dto/animal.dto';
import { HERD_COLUMNS, HerdListService } from './herd-list.service';

@ApiTags('pig-herd')
@Controller('pig-herd')
export class HerdListController {
  constructor(private readonly herd: HerdListService) {}

  @Get()
  @RequirePermission('porcs', 'read')
  async list(
    @Ctx() ctx: RequestContext,
    @Query() q: HerdListQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const { find, count, extra } = this.herd.listArgs(ctx, q);
    await sendList(res, q, 'cheptel-porcin', HERD_COLUMNS, find, count, extra);
  }
}
