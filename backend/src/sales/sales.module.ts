import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { EggsModule } from '../eggs/eggs.module';
import { HerdModule } from '../herd/herd.module';
import { PigsModule } from '../pigs/pigs.module';
import { StockModule } from '../stock/stock.module';
import { SaleEggOutflows } from './egg-outflows';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';
import { QuotesController } from './quotes.controller';
import { QuotesService } from './quotes.service';
import { SaleEffects } from './sale-effects';
import { SaleLineResolver } from './sale-line-resolver';
import { SellablesController } from './sellables.controller';
import { SellablesService } from './sellables.service';

/** Sales documents: quotes, invoices (drafts, issue through the ledgers, cancellation), later client payments and credit notes. */
@Module({
  imports: [AdminModule, EggsModule, HerdModule, PigsModule, StockModule],
  // SellablesController first: `GET /sales/sellables` must not be taken for `GET /sales/:id`.
  controllers: [QuotesController, SellablesController, InvoicesController],
  providers: [
    QuotesService,
    InvoicesService,
    SaleEffects,
    SaleEggOutflows,
    SaleLineResolver,
    SellablesService,
  ],
  exports: [SaleLineResolver],
})
export class SalesModule {}
