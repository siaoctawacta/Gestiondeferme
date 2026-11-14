import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { HerdModule } from '../herd/herd.module';
import { IndicatorsModule } from '../indicators/indicators.module';
import { PigsModule } from '../pigs/pigs.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

/** Reads figures from the herd and pig modules and the open alerts from `IndicatorsModule`; nothing imports it. */
@Module({
  imports: [AdminModule, HerdModule, PigsModule, IndicatorsModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
