import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
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
  RequireMaster,
  RequirePermission,
} from '../access/decorators';
import type { RequestContext } from '../access/decorators';
import { sendList } from '../listing/list-helpers';
import {
  CreateSupplierDto,
  SupplierQueryDto,
  UpdateSupplierDto,
} from './dto/supplier.dto';
import { SUPPLIER_COLUMNS, SuppliersService } from './suppliers.service';

/**
 * Suppliers belong to the organisation: every route is `@NoFarm`. The
 * `X-Farm-Id` header only chooses which purchases the `balance` counts.
 */
@ApiTags('suppliers')
@Controller('suppliers')
@NoFarm()
export class SuppliersController {
  constructor(private readonly suppliers: SuppliersService) {}

  @Get()
  @RequirePermission('fournisseurs', 'read')
  async list(
    @Ctx() ctx: RequestContext,
    @Query() q: SupplierQueryDto,
    @Headers('x-farm-id') farm: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const { find, count } = await this.suppliers.listArgs(ctx, q, farm);
    await sendList(res, q, 'fournisseurs', SUPPLIER_COLUMNS, find, count);
  }

  @Get(':id')
  @RequirePermission('fournisseurs', 'read')
  get(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Headers('x-farm-id') farm: string | undefined,
  ) {
    return this.suppliers.get(ctx, id, farm);
  }

  @Post()
  @RequireMaster('fournisseurs')
  create(@Ctx() ctx: RequestContext, @Body() dto: CreateSupplierDto) {
    return this.suppliers.create(ctx, dto);
  }

  @Patch(':id')
  @RequireMaster('fournisseurs')
  update(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: UpdateSupplierDto,
    @Headers('x-farm-id') farm: string | undefined,
  ) {
    return this.suppliers.update(ctx, id, dto, farm);
  }

  @Delete(':id')
  @RequireMaster('fournisseurs')
  remove(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.suppliers.remove(ctx, id);
  }
}
