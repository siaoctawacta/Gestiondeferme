import { Module } from '@nestjs/common';
import { AccessModule } from './access/access.module';
import { AdminModule } from './admin/admin.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { HealthController } from './health/health.controller';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [PrismaModule, AccessModule, AuditModule, AuthModule, AdminModule],
  controllers: [HealthController],
})
export class AppModule {}
