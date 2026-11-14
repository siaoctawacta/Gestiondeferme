import { Module } from '@nestjs/common';
import { AccessModule } from './access/access.module';
import { AuthModule } from './auth/auth.module';
import { HealthController } from './health/health.controller';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [PrismaModule, AccessModule, AuthModule],
  controllers: [HealthController],
})
export class AppModule {}
