import { Module } from '@nestjs/common';
import { HerdModule } from '../herd/herd.module';
import { StockModule } from '../stock/stock.module';
import { AlertAcksService } from './alerts/alert-acks.service';
import { AlertsRegistry } from './alerts/alerts-registry';
import { HealthAlertsService } from './alerts/health-alerts.service';
import { ProductionAlertsService } from './alerts/production-alerts.service';
import { StockAlertsService } from './alerts/stock-alerts.service';
import { IndicatorsService } from './indicators.service';
import { LotCostRegistry } from './lot-cost';

/**
 * Imports `herd` and `stock` (never the reverse); the feed, health and finance modules import this one to register a `LotCostSource`.
 * Production, stock, expiry and health alert rules live here and read the tables through `PrismaService` (and the stock ledger for levels); other modules may add rules to `AlertsRegistry`.
 */
@Module({
  imports: [HerdModule, StockModule],
  providers: [
    LotCostRegistry,
    AlertsRegistry,
    AlertAcksService,
    IndicatorsService,
    ProductionAlertsService,
    StockAlertsService,
    HealthAlertsService,
  ],
  exports: [
    LotCostRegistry,
    AlertsRegistry,
    AlertAcksService,
    IndicatorsService,
  ],
})
export class IndicatorsModule {}
