import { Module } from '@nestjs/common';
import { AccessModule } from './access/access.module';
import { AdminModule } from './admin/admin.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { BreedingModule } from './breeding/breeding.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { EggsModule } from './eggs/eggs.module';
import { HerdModule } from './herd/herd.module';
import { HealthController } from './health/health.controller';
import { IndicatorsModule } from './indicators/indicators.module';
import { PigsModule } from './pigs/pigs.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    PrismaModule,
    AccessModule,
    AuditModule,
    AuthModule,
    AdminModule,
    HerdModule,
    EggsModule,
    PigsModule,
    BreedingModule,
    IndicatorsModule,
    DashboardModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
