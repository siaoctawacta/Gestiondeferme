import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { RequestContext } from '../access/decorators';
import { formatDay, today } from '../common/days';
import { BreedingService } from '../breeding/breeding.service';
import { DashboardService } from '../dashboard/dashboard.service';
import { FarmKpisService } from '../dashboard/farm-kpis.service';
import { EggProductionService } from '../eggs/egg-production.service';
import { EquipmentReads } from '../equipment/equipment-reads.service';
import { FeedService } from '../feed/feed.service';
import { FinanceSummaryService } from '../finance/finance-summary.service';
import { LotProfitabilityService } from '../finance/lot-profitability.service';
import { HealthReport } from '../health/health-report';
import { BatchesService } from '../herd/batches.service';
import { HerdLedgerService } from '../herd/herd-ledger.service';
import { IndicatorsService } from '../indicators/indicators.service';
import { HerdListService } from '../pigs/herd-list.service';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentsJournal } from '../sales/payments-journal';
import { StockOverviewService } from '../stock/stock-overview.service';
import { TaskReads } from '../tasks/task-reads.service';
import type { ReportQueryDto } from './dto/report-query.dto';
import {
  REPORT_TYPES,
  reportPeriod,
  reportTitle,
  type ReportType,
} from './report-periods';
import { REPORT_SECTIONS, type SectionDef } from './report-sections';
import type { ReportDto } from './report.types';

export const UNKNOWN_REPORT = 'Rapport inconnu';
export const REPORT_FORBIDDEN = "Ce rapport n'est pas accessible à votre rôle";

const TYPE_LABEL: Record<ReportType, string> = {
  synthese: 'Synthèse',
  quotidien: 'Quotidien',
  hebdomadaire: 'Hebdomadaire',
  mensuel: 'Mensuel',
  annuel: 'Annuel',
  sanitaire: 'Sanitaire',
  zootechnique: 'Zootechnique',
};

/**
 * The seven reports. A report is a list of sections, each gated by the module
 * the role must read; every figure in it is the return value of the function
 * that already serves a screen (`FarmKpisService`, the period functions of the
 * modules, `FinanceSummaryService`, `LotProfitabilityService`...), so a number
 * in a report is the number of the screen for the same period. A role sees only
 * the sections it can read: no money without `finance:read`, in the JSON or in
 * either file.
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly kpis: FarmKpisService,
    private readonly dashboard: DashboardService,
    private readonly eggs: EggProductionService,
    private readonly feed: FeedService,
    private readonly ledger: HerdLedgerService,
    private readonly herd: HerdListService,
    private readonly breeding: BreedingService,
    private readonly batches: BatchesService,
    private readonly indicators: IndicatorsService,
    private readonly stock: StockOverviewService,
    private readonly health: HealthReport,
    private readonly tasks: TaskReads,
    private readonly equipment: EquipmentReads,
    private readonly finance: FinanceSummaryService,
    private readonly lotProfit: LotProfitabilityService,
    private readonly payments: PaymentsJournal,
  ) {}

  private visible(ctx: RequestContext, type: ReportType): SectionDef[] {
    return REPORT_SECTIONS[type].filter((s) => s.allowed(ctx.user.role));
  }

  /** The report types with at least one section the role can see. */
  types(ctx: RequestContext): { types: { type: ReportType; label: string }[] } {
    return {
      types: REPORT_TYPES.filter((t) => this.visible(ctx, t).length > 0).map(
        (type) => ({ type, label: TYPE_LABEL[type] }),
      ),
    };
  }

  async report(
    ctx: RequestContext,
    type: string,
    q: ReportQueryDto,
  ): Promise<ReportDto> {
    if (!REPORT_TYPES.includes(type as ReportType)) {
      throw new NotFoundException(UNKNOWN_REPORT);
    }
    const kind = type as ReportType;
    const defs = this.visible(ctx, kind);
    if (defs.length === 0) throw new ForbiddenException(REPORT_FORBIDDEN);
    const period = reportPeriod(kind, q, today());
    const memo = new Map<string, Promise<unknown>>();
    const env = {
      ctx,
      period,
      readers: {
        prisma: this.prisma,
        kpis: this.kpis,
        dashboard: this.dashboard,
        eggs: this.eggs,
        feed: this.feed,
        ledger: this.ledger,
        herd: this.herd,
        breeding: this.breeding,
        batches: this.batches,
        indicators: this.indicators,
        stock: this.stock,
        health: this.health,
        tasks: this.tasks,
        equipment: this.equipment,
        finance: this.finance,
        lotProfit: this.lotProfit,
        payments: this.payments,
      },
      once<T>(key: string, load: () => Promise<T>): Promise<T> {
        if (!memo.has(key)) memo.set(key, load());
        return memo.get(key) as Promise<T>;
      },
    };
    const [farmName, sections] = await Promise.all([
      this.dashboard.farmName(ctx),
      Promise.all(defs.map((d) => d.build(env))),
    ]);
    return {
      type: kind,
      title: reportTitle(kind, period),
      from: formatDay(period.from),
      to: formatDay(period.to),
      generatedAt: new Date().toISOString(),
      farmName,
      sections,
    };
  }
}
