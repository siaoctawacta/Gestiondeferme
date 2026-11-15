import { Module } from '@nestjs/common';
import { HerdModule } from '../herd/herd.module';
import { StockModule } from '../stock/stock.module';
import { BiosecurityController } from './biosecurity.controller';
import { BiosecurityService } from './biosecurity.service';
import { HealthActsController } from './health-acts.controller';
import { HealthActsService } from './health-acts.service';
import { HealthHistory } from './health-history';
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
 * registers with `herd` (withdrawal periods, earliest record of a lot).
 */
@Module({
  imports: [HerdModule, StockModule],
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
    HealthActsService,
    VaccinationPlansService,
    QuarantinesService,
    IncidentsService,
    BiosecurityService,
  ],
})
export class HealthModule {}
