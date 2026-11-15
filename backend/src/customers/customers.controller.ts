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
import { CUSTOMER_COLUMNS, CustomersService } from './customers.service';
import {
  CreateCustomerDto,
  CustomerQueryDto,
  UpdateCustomerDto,
} from './dto/customer.dto';

/**
 * Customers belong to the organisation: every route is `@NoFarm`. The
 * `X-Farm-Id` header only chooses which invoices the `balance` counts.
 */
@ApiTags('customers')
@Controller('customers')
@NoFarm()
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  @RequirePermission('clients', 'read')
  async list(
    @Ctx() ctx: RequestContext,
    @Query() q: CustomerQueryDto,
    @Headers('x-farm-id') farm: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const { find, count } = await this.customers.listArgs(ctx, q, farm);
    await sendList(res, q, 'clients', CUSTOMER_COLUMNS, find, count);
  }

  @Get(':id')
  @RequirePermission('clients', 'read')
  get(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Headers('x-farm-id') farm: string | undefined,
  ) {
    return this.customers.get(ctx, id, farm);
  }

  @Post()
  @RequireMaster('clients')
  create(@Ctx() ctx: RequestContext, @Body() dto: CreateCustomerDto) {
    return this.customers.create(ctx, dto);
  }

  @Patch(':id')
  @RequireMaster('clients')
  update(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: UpdateCustomerDto,
    @Headers('x-farm-id') farm: string | undefined,
  ) {
    return this.customers.update(ctx, id, dto, farm);
  }

  @Delete(':id')
  @RequireMaster('clients')
  remove(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.customers.remove(ctx, id);
  }
}
