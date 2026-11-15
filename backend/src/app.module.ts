import { Module } from '@nestjs/common';
import { AccessModule } from './access/access.module';
import { AdminModule } from './admin/admin.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { BreedingModule } from './breeding/breeding.module';
import { CustomersModule } from './customers/customers.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { EggsModule } from './eggs/eggs.module';
import { FeedModule } from './feed/feed.module';
import { FinanceModule } from './finance/finance.module';
import { HerdModule } from './herd/herd.module';
import { HealthController } from './health/health.controller';
import { HealthModule } from './health/health.module';
import { IndicatorsModule } from './indicators/indicators.module';
import { PigsModule } from './pigs/pigs.module';
import { PrismaModule } from './prisma/prisma.module';
import { PurchasesModule } from './purchases/purchases.module';
import { SalesModule } from './sales/sales.module';
import { StockModule } from './stock/stock.module';
import { SuppliersModule } from './suppliers/suppliers.module';

@Module({
  imports: [
    PrismaModule,
    AccessModule,
    AuditModule,
    AuthModule,
    AdminModule,
    HerdModule,
    EggsModule,
    FeedModule,
    HealthModule,
    PigsModule,
    BreedingModule,
    StockModule,
    SuppliersModule,
    PurchasesModule,
    CustomersModule,
    SalesModule,
    FinanceModule,
    IndicatorsModule,
    DashboardModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
