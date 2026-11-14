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
import { Ctx, NoFarm, RequirePermission } from '../../access/decorators';
import type { RequestContext } from '../../access/decorators';
import { Audited } from '../../audit/audited.decorator';
import { ListQueryDto } from '../../listing/list-query.dto';
import { sendList } from '../../listing/list-helpers';
import { CreateUserDto, UpdateUserDto } from './users.dto';
import { USER_COLUMNS, UsersService } from './users.service';

@ApiTags('users')
@NoFarm()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermission('utilisateurs', 'read')
  async list(
    @Ctx() ctx: RequestContext,
    @Query() q: ListQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const { find, count } = this.users.listArgs(ctx, q);
    await sendList(res, q, 'utilisateurs', USER_COLUMNS, find, count);
  }

  @Post()
  @RequirePermission('utilisateurs', 'create')
  @Audited('utilisateurs', { entity: UsersService })
  create(@Ctx() ctx: RequestContext, @Body() dto: CreateUserDto) {
    return this.users.create(ctx, dto);
  }

  @Patch(':id')
  @RequirePermission('utilisateurs', 'update')
  @Audited('utilisateurs', { entity: UsersService })
  update(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.users.update(ctx, id, dto);
  }

  @Delete(':id')
  @RequirePermission('utilisateurs', 'delete')
  @Audited('utilisateurs', { entity: UsersService })
  remove(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.users.remove(ctx, id);
  }

  @Post(':id/reset-link')
  @RequirePermission('utilisateurs', 'update')
  resetLink(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.users.issueResetLink(ctx, id);
  }

  @Post(':id/reset-2fa')
  @HttpCode(204)
  @RequirePermission('utilisateurs', 'update')
  async resetTwoFactor(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
  ): Promise<void> {
    await this.users.resetTwoFactor(ctx, id);
  }
}
