import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AccessGuard } from './access.guard';
import { AccessService } from './access.service';

@Global()
@Module({
  providers: [AccessService, { provide: APP_GUARD, useClass: AccessGuard }],
  exports: [AccessService],
})
export class AccessModule {}
