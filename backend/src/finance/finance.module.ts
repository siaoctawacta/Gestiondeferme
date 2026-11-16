import { Module } from '@nestjs/common';
import { HerdModule } from '../herd/herd.module';
import { IndicatorsModule } from '../indicators/indicators.module';
import { FinanceEntriesController } from './finance-entries.controller';
import { FinanceEntriesService } from './finance-entries.service';
import { FinanceLedger } from './finance-ledger';
import { FinanceReportsController } from './finance-reports.controller';
import { FinanceSummaryService } from './finance-summary.service';
import { LotProfitabilityService } from './lot-profitability.service';
import { ManualLotCosts } from './manual-lot-costs';

/**
 * Money in and out. Finance stores only manual entries; what the screens list
 * besides them is read from the documents through the SQL view
 * "FinanceLedgerView" (`FinanceLedger` is its only reader). Imports `herd`
 * (headcounts) and `indicators` (the lot cost registry the feed, health and manual
 * sources register in); it imports neither sales nor purchases (the view reads their tables); the dashboard imports this module for the summary.
 */
@Module({
  imports: [HerdModule, IndicatorsModule],
  controllers: [FinanceEntriesController, FinanceReportsController],
  providers: [
    FinanceLedger,
    FinanceEntriesService,
    FinanceSummaryService,
    LotProfitabilityService,
    ManualLotCosts,
  ],
  exports: [FinanceSummaryService],
})
export class FinanceModule {}
