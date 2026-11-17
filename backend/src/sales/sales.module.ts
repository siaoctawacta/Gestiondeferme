import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { EggsModule } from '../eggs/eggs.module';
import { HerdModule } from '../herd/herd.module';
import { IndicatorsModule } from '../indicators/indicators.module';
import { PigsModule } from '../pigs/pigs.module';
import { StockModule } from '../stock/stock.module';
import { CreditNotesController } from './credit-notes.controller';
import { CreditNotesService } from './credit-notes.service';
import { SaleEggOutflows } from './egg-outflows';
import { InvoiceReads } from './invoice-reads.service';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';
import { PaymentsJournal } from './payments-journal';
import { PaymentsJournalController } from './payments-journal.controller';
import { PaymentsService } from './payments.service';
import { QuotesController } from './quotes.controller';
import { QuotesService } from './quotes.service';
import { ReceivableAlertsService } from './receivable-alerts.service';
import { SaleEffects } from './sale-effects';
import { SaleLineResolver } from './sale-line-resolver';
import { SellablesController } from './sellables.controller';
import { SellablesService } from './sellables.service';

/** Sales documents: quotes, invoices (drafts, issue through the ledgers, cancellation), client payments, credit notes with returns, and the overdue-receivable alert. */
@Module({
  imports: [
    AdminModule,
    EggsModule,
    HerdModule,
    IndicatorsModule,
    PigsModule,
    StockModule,
  ],
  // SellablesController and PaymentsJournalController first: `GET /sales/sellables` and `GET /sales/payments` must not be taken for `GET /sales/:id`.
  controllers: [
    QuotesController,
    SellablesController,
    PaymentsJournalController,
    InvoicesController,
    CreditNotesController,
  ],
  exports: [PaymentsJournal],
  providers: [
    QuotesService,
    InvoiceReads,
    InvoicesService,
    PaymentsService,
    PaymentsJournal,
    CreditNotesService,
    ReceivableAlertsService,
    SaleEffects,
    SaleEggOutflows,
    SaleLineResolver,
    SellablesService,
  ],
})
export class SalesModule {}
