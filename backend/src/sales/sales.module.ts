import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { QuotesController } from './quotes.controller';
import { QuotesService } from './quotes.service';
import { SaleLineResolver } from './sale-line-resolver';

/** Sales documents: quotes now, then invoices, client payments and credit notes. */
@Module({
  imports: [AdminModule],
  controllers: [QuotesController],
  providers: [QuotesService, SaleLineResolver],
  exports: [SaleLineResolver],
})
export class SalesModule {}
