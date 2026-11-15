import { Module } from '@nestjs/common';
import { HerdModule } from '../herd/herd.module';
import { AnimalTargets } from './animal-targets';
import { AnimalsController } from './animals.controller';
import { AnimalsService } from './animals.service';
import { HerdListController } from './herd-list.controller';
import { HerdListService } from './herd-list.service';

/** Individual pigs (sows, boars, gilts) and the mixed pig herd list; animals house themselves through `OccupationRegistry` and can be the target of an operation through `AnimalTargetRegistry`. */
@Module({
  imports: [HerdModule],
  controllers: [AnimalsController, HerdListController],
  providers: [AnimalsService, AnimalTargets, HerdListService],
  exports: [AnimalsService, HerdListService],
})
export class PigsModule {}
