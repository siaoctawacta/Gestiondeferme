import { Module } from '@nestjs/common';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { EmployeesController } from './employees.controller';
import { EmployeesService } from './employees.service';

/** Staff of a farm: employees (master data), daily attendance and the payroll preview. */
@Module({
  controllers: [EmployeesController, AttendanceController],
  providers: [EmployeesService, AttendanceService],
})
export class PersonnelModule {}
