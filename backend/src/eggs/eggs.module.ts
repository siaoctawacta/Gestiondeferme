import { Module } from '@nestjs/common';
import { HerdModule } from '../herd/herd.module';
import { EggProductionController } from './egg-production.controller';
import { EggProductionService } from './egg-production.service';
import { IncubationsController } from './incubations.controller';
import { IncubationsService } from './incubations.service';

/** Egg collection records and incubations (hatching creates a chick batch through `HerdModule`). */
@Module({
  imports: [HerdModule],
  controllers: [EggProductionController, IncubationsController],
  providers: [EggProductionService, IncubationsService],
})
export class EggsModule {}
