import { Module } from '@nestjs/common';
import { BatchEventsService } from './batch-events.service';
import { BatchesController } from './batches.controller';
import { BatchesService } from './batches.service';
import { BreedsController } from './breeds.controller';
import { BreedsService } from './breeds.service';
import { HerdLedgerService } from './herd-ledger.service';
import { OccupationRegistry } from './occupation';
import { WeighingsController } from './weighings.controller';
import { WeighingsService } from './weighings.service';

/**
 * Headcount of poultry lots and pig groups. `AdminModule` imports this module
 * (never the reverse), and later modules (incubation, pigs) import it to
 * create batches and to register their own `OccupationSource`.
 */
@Module({
  controllers: [BatchesController, BreedsController, WeighingsController],
  providers: [
    OccupationRegistry,
    HerdLedgerService,
    BatchesService,
    BatchEventsService,
    WeighingsService,
    BreedsService,
  ],
  exports: [OccupationRegistry, HerdLedgerService, BatchesService],
})
export class HerdModule {}
