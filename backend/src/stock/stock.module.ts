import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { InventoriesController } from './inventories.controller';
import { InventoriesService } from './inventories.service';
import { StockItemsController } from './stock-items.controller';
import { StockItemsService } from './stock-items.service';
import { StockLedgerService } from './stock-ledger.service';
import { StockMovementsController } from './stock-movements.controller';
import { StockMovementsService } from './stock-movements.service';
import { StockOverviewController } from './stock-overview.controller';
import { StockOverviewService } from './stock-overview.service';

/**
 * Stock items, levels, movements and inventories. The ledger is exported:
 * purchases, feed distributions and health acts record and reverse their stock
 * movements through it, inside their own transactions.
 */
@Module({
  imports: [AdminModule],
  controllers: [
    StockItemsController,
    // Before the overview: `/stock/movements` must win over `/stock/:itemId`.
    StockMovementsController,
    StockOverviewController,
    InventoriesController,
  ],
  providers: [
    StockLedgerService,
    StockItemsService,
    StockMovementsService,
    StockOverviewService,
    InventoriesService,
  ],
  exports: [StockLedgerService, StockItemsService, StockOverviewService],
})
export class StockModule {}
