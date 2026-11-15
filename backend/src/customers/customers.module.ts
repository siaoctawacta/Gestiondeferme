import { Module } from '@nestjs/common';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';

/** Organisation-wide customer sheets (master data); quotes and invoices link to them by id. */
@Module({
  controllers: [CustomersController],
  providers: [CustomersService],
})
export class CustomersModule {}
