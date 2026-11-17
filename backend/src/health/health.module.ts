import { Module } from '@nestjs/common';
import { HerdModule } from '../herd/herd.module';
import { IndicatorsModule } from '../indicators/indicators.module';
import { StockModule } from '../stock/stock.module';
import { BiosecurityController } from './biosecurity.controller';
import { BiosecurityService } from './biosecurity.service';
import { HealthActsController } from './health-acts.controller';
import { HealthActsService } from './health-acts.service';
import { HealthCosts } from './health-costs';
import { HealthHistory } from './health-history';
import { HealthReport } from './health-report';
import { HealthStock } from './health-stock';
import { HealthTargets } from './health-targets';
import { IncidentsController } from './incidents.controller';
import { IncidentsService } from './incidents.service';
import { QuarantinesController } from './quarantines.controller';
import { QuarantinesService } from './quarantines.service';
import { VaccinationPlansController } from './vaccination-plans.controller';
import { VaccinationPlansService } from './vaccination-plans.service';

/**
 * Health acts, vaccination plans, quarantines, incidents and biosecurity logs.
 * Done acts consume veterinary stock through the ledger; `HealthHistory`
 * registers with `herd` (withdrawal periods, earliest record of a lot); `HealthCosts`
 * registers with the indicators (what a lot's medicines and vaccines cost).
 */
@Module({
  imports: [HerdModule, IndicatorsModule, StockModule],
  controllers: [
    HealthActsController,
    VaccinationPlansController,
    QuarantinesController,
    IncidentsController,
    BiosecurityController,
  ],
  providers: [
    HealthTargets,
    HealthStock,
    HealthHistory,
    HealthReport,
    HealthCosts,
    HealthActsService,
    VaccinationPlansService,
    QuarantinesService,
    IncidentsService,
    BiosecurityService,
  ],
  exports: [HealthReport, HealthTargets],
})
export class HealthModule {}
