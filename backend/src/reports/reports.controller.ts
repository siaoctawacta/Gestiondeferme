import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Ctx, RequirePermission } from '../access/decorators';
import type { RequestContext } from '../access/decorators';
import { ReportQueryDto } from './dto/report-query.dto';
import { reportCsv, reportFilename, reportXlsx } from './report-export';
import { ReportsService } from './reports.service';

const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** The reports of the farms in view, `rapports:read`; each section is further gated by its own module. */
@ApiTags('reports')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get()
  @RequirePermission('rapports', 'read')
  types(@Ctx() ctx: RequestContext) {
    return this.reports.types(ctx);
  }

  @Get(':type')
  @RequirePermission('rapports', 'read')
  async report(
    @Ctx() ctx: RequestContext,
    @Param('type') type: string,
    @Query() q: ReportQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const report = await this.reports.report(ctx, type, q);
    if (!q.format) {
      res.json(report);
      return;
    }
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${reportFilename(report)}.${q.format}"`,
    );
    if (q.format === 'xlsx') {
      res.setHeader('Content-Type', XLSX_MIME);
      res.send(await reportXlsx(report));
    } else {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.send(reportCsv(report));
    }
  }
}
