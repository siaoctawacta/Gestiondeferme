import { Module } from '@nestjs/common';
import { HerdModule } from '../herd/herd.module';
import { AlertsRegistry } from './alerts/alerts-registry';
import { ProductionAlertsService } from './alerts/production-alerts.service';
import { FeedRegistry } from './feed-source';
import { IndicatorsService } from './indicators.service';

/**
 * Imports `herd` (never the reverse); the feed module imports this one to register a `FeedSource`.
 * Production alert rules live here and read the tables through `PrismaService`; other modules may add rules to `AlertsRegistry`.
 */
@Module({
  imports: [HerdModule],
  providers: [
    FeedRegistry,
    AlertsRegistry,
    IndicatorsService,
    ProductionAlertsService,
  ],
  exports: [FeedRegistry, AlertsRegistry, IndicatorsService],
})
export class IndicatorsModule {}
