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
import { Ctx, RequireDaily, RequirePermission } from '../access/decorators';
import type { RequestContext } from '../access/decorators';
import { paginate } from '../listing/paginate';
import {
  BiosecurityQueryDto,
  CreateBiosecurityDto,
  UpdateBiosecurityDto,
} from './dto/biosecurity.dto';
import { BiosecurityService } from './biosecurity.service';

/** Daily entries of the `sante` module: `create` writes, edits and deletes. */
@ApiTags('biosecurity-logs')
@Controller('biosecurity-logs')
export class BiosecurityController {
  constructor(private readonly records: BiosecurityService) {}

  @Get()
  @RequirePermission('sante', 'read')
  list(@Ctx() ctx: RequestContext, @Query() q: BiosecurityQueryDto) {
    const { find, count } = this.records.listArgs(ctx, q);
    return paginate(q, find, count);
  }

  @Post()
  @RequireDaily('sante')
  create(@Ctx() ctx: RequestContext, @Body() dto: CreateBiosecurityDto) {
    return this.records.create(ctx, dto);
  }

  @Patch(':id')
  @RequireDaily('sante')
  update(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: UpdateBiosecurityDto,
  ) {
    return this.records.update(ctx, id, dto);
  }

  @Delete(':id')
  @RequireDaily('sante')
  remove(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.records.remove(ctx, id);
  }
}
