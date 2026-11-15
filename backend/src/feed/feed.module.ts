import { Module } from '@nestjs/common';
import { HerdModule } from '../herd/herd.module';
import { IndicatorsModule } from '../indicators/indicators.module';
import { StockModule } from '../stock/stock.module';
import { FeedDistributionsController } from './feed-distributions.controller';
import { FeedDistributionsService } from './feed-distributions.service';
import { FeedFormulasController } from './feed-formulas.controller';
import { FeedFormulasService } from './feed-formulas.service';
import { FeedProductsController } from './feed-products.controller';
import { FeedProductsService } from './feed-products.service';
import { FeedTargets } from './feed-targets';
import { FeedService } from './feed.service';
import { WaterController } from './water.controller';
import { WaterService } from './water.service';

/** Feed products, formulas, distributions and water; registers a `LotCostSource` with the indicators. */
@Module({
  imports: [HerdModule, IndicatorsModule, StockModule],
  controllers: [
    FeedProductsController,
    FeedFormulasController,
    FeedDistributionsController,
    WaterController,
  ],
  providers: [
    FeedService,
    FeedTargets,
    FeedProductsService,
    FeedFormulasService,
    FeedDistributionsService,
    WaterService,
  ],
})
export class FeedModule {}
