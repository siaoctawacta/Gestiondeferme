import { Module } from '@nestjs/common';
import { HerdModule } from '../herd/herd.module';
import {
  AnimalReproductionController,
  BreedingController,
} from './breeding.controller';
import { BreedingService } from './breeding.service';
import { HeatsService } from './heats.service';

/** Services, farrowings and weanings of the sows; a farrowing creates the litter's batch through `HerdModule`. */
@Module({
  imports: [HerdModule],
  controllers: [BreedingController, AnimalReproductionController],
  providers: [BreedingService, HeatsService],
})
export class BreedingModule {}
