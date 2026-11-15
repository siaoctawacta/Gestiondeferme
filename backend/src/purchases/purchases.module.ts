import { Module } from '@nestjs/common';
import { StockModule } from '../stock/stock.module';
import { PurchasesController } from './purchases.controller';
import { PurchasesService } from './purchases.service';

/** Purchase requests, orders and supplier payments; receptions enter the stock through the ledger. */
@Module({
  imports: [StockModule],
  controllers: [PurchasesController],
  providers: [PurchasesService],
})
export class PurchasesModule {}
