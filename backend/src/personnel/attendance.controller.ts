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
import { Ctx, RequireDaily, RequirePermission } from '../access/decorators';
import type { RequestContext } from '../access/decorators';
import { sendList } from '../listing/list-helpers';
import { AttendanceService } from './attendance.service';
import {
  AttendanceDayDto,
  AttendanceQueryDto,
  CreateAttendanceDto,
  UpdateAttendanceDto,
} from './dto/attendance.dto';
import { ATTENDANCE_COLUMNS } from './employee-view';

/** Attendance is a daily entry of `personnel`: `create` writes, edits and deletes. */
@ApiTags('attendance')
@Controller('attendance')
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @Get()
  @RequirePermission('personnel', 'read')
  async list(
    @Ctx() ctx: RequestContext,
    @Query() q: AttendanceQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const { find, count, statusCounts } = this.attendance.listArgs(ctx, q);
    await sendList(
      res,
      q,
      'presences',
      ATTENDANCE_COLUMNS,
      find,
      count,
      statusCounts,
    );
  }

  @Post()
  @RequireDaily('personnel')
  create(@Ctx() ctx: RequestContext, @Body() dto: CreateAttendanceDto) {
    return this.attendance.create(ctx, dto);
  }

  /** The day sheet: sets the listed employees' attendance of one day in one transaction. */
  @Post('day')
  @HttpCode(200)
  @RequireDaily('personnel')
  setDay(@Ctx() ctx: RequestContext, @Body() dto: AttendanceDayDto) {
    return this.attendance.setDay(ctx, dto);
  }

  @Patch(':id')
  @RequireDaily('personnel')
  update(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: UpdateAttendanceDto,
  ) {
    return this.attendance.update(ctx, id, dto);
  }

  @Delete(':id')
  @RequireDaily('personnel')
  remove(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.attendance.remove(ctx, id);
  }
}
