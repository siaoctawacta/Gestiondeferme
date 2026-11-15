import { Module } from '@nestjs/common';
import { HerdModule } from '../herd/herd.module';
import { AlertsRegistry } from './alerts/alerts-registry';
import { ProductionAlertsService } from './alerts/production-alerts.service';
import { IndicatorsService } from './indicators.service';
import { LotCostRegistry } from './lot-cost';

/**
 * Imports `herd` (never the reverse); the feed module imports this one to register a `LotCostSource`.
 * Production alert rules live here and read the tables through `PrismaService`; other modules may add rules to `AlertsRegistry`.
 */
@Module({
  imports: [HerdModule],
  providers: [
    LotCostRegistry,
    AlertsRegistry,
    IndicatorsService,
    ProductionAlertsService,
  ],
  exports: [LotCostRegistry, AlertsRegistry, IndicatorsService],
})
export class IndicatorsModule {}
