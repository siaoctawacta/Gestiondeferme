import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { EggsModule } from '../eggs/eggs.module';
import { HerdModule } from '../herd/herd.module';
import { StockModule } from '../stock/stock.module';
import { QuotesController } from './quotes.controller';
import { QuotesService } from './quotes.service';
import { SellablesController } from './sellables.controller';
import { SellablesService } from './sellables.service';
import { SaleLineResolver } from './sale-line-resolver';

/** Sales documents: quotes now, then invoices, client payments and credit notes. */
@Module({
  imports: [AdminModule, EggsModule, HerdModule, StockModule],
  controllers: [QuotesController, SellablesController],
  providers: [QuotesService, SaleLineResolver, SellablesService],
  exports: [SaleLineResolver],
})
export class SalesModule {}
