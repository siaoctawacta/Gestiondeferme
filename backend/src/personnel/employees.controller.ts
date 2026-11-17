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
  AnyAuthenticated,
  Ctx,
  RequireMaster,
  RequirePermission,
} from '../access/decorators';
import type { RequestContext } from '../access/decorators';
import { sendList } from '../listing/list-helpers';
import {
  CreateEmployeeDto,
  EmployeeOptionsQueryDto,
  EmployeeQueryDto,
  PayrollQueryDto,
  UpdateEmployeeDto,
} from './dto/employee.dto';
import { employeeColumns } from './employee-view';
import { EmployeesService } from './employees.service';

/**
 * Employees are master data of `personnel` (`update` writes). The fixed paths
 * come before `:id`.
 */
@ApiTags('employees')
@Controller('employees')
export class EmployeesController {
  constructor(private readonly employees: EmployeesService) {}

  @Get()
  @RequirePermission('personnel', 'read')
  async list(
    @Ctx() ctx: RequestContext,
    @Query() q: EmployeeQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const { find, count, statusCounts, withSalary } = this.employees.listArgs(
      ctx,
      q,
    );
    await sendList(
      res,
      q,
      'employes',
      employeeColumns(withSalary),
      find,
      count,
      statusCounts,
    );
  }

  /** Who works on a day, for the selects of the task form and the day sheet: no salary, any user of the farm. */
  @Get('options')
  @AnyAuthenticated()
  options(@Ctx() ctx: RequestContext, @Query() q: EmployeeOptionsQueryDto) {
    return this.employees.options(ctx, q.at);
  }

  /** The users of the farm an employee can be linked to (the Directeur has no `utilisateurs` read). */
  @Get('user-options')
  @RequirePermission('personnel', 'update')
  userOptions(@Ctx() ctx: RequestContext) {
    return this.employees.userOptions(ctx);
  }

  /** What the staff costs for a month: prefills the Comptable's manual `Salaires` entry; writes nothing. */
  @Get('payroll')
  @RequirePermission('finance', 'create')
  payroll(@Ctx() ctx: RequestContext, @Query() q: PayrollQueryDto) {
    return this.employees.payroll(ctx, q.month);
  }

  @Get(':id')
  @RequirePermission('personnel', 'read')
  get(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.employees.get(ctx, id);
  }

  @Post()
  @RequireMaster('personnel')
  create(@Ctx() ctx: RequestContext, @Body() dto: CreateEmployeeDto) {
    return this.employees.create(ctx, dto);
  }

  @Patch(':id')
  @RequireMaster('personnel')
  update(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: UpdateEmployeeDto,
  ) {
    return this.employees.update(ctx, id, dto);
  }

  @Delete(':id')
  @RequireMaster('personnel')
  remove(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.employees.remove(ctx, id);
  }
}
