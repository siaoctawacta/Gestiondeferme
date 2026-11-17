import { Module } from '@nestjs/common';
import { BreedingModule } from '../breeding/breeding.module';
import { DashboardModule } from '../dashboard/dashboard.module';
import { EggsModule } from '../eggs/eggs.module';
import { EquipmentModule } from '../equipment/equipment.module';
import { FeedModule } from '../feed/feed.module';
import { FinanceModule } from '../finance/finance.module';
import { HealthModule } from '../health/health.module';
import { HerdModule } from '../herd/herd.module';
import { IndicatorsModule } from '../indicators/indicators.module';
import { PigsModule } from '../pigs/pigs.module';
import { SalesModule } from '../sales/sales.module';
import { StockModule } from '../stock/stock.module';
import { TasksModule } from '../tasks/tasks.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

/**
 * Server reports (synthèse, daily to annual, sanitary, zootechnical) and their
 * CSV / Excel files. It owns no figure: it reads the modules that do, and
 * nothing imports it.
 */
@Module({
  imports: [
    BreedingModule,
    DashboardModule,
    EggsModule,
    EquipmentModule,
    FeedModule,
    FinanceModule,
    HealthModule,
    HerdModule,
    IndicatorsModule,
    PigsModule,
    SalesModule,
    StockModule,
    TasksModule,
  ],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
