import { Module } from '@nestjs/common';
import { HerdModule } from '../herd/herd.module';
import { AnimalsController } from './animals.controller';
import { AnimalsService } from './animals.service';
import { HerdListController } from './herd-list.controller';
import { HerdListService } from './herd-list.service';

/** Individual pigs (sows, boars, gilts) and the mixed pig herd list; animals house themselves through `OccupationRegistry`. */
@Module({
  imports: [HerdModule],
  controllers: [AnimalsController, HerdListController],
  providers: [AnimalsService, HerdListService],
  exports: [AnimalsService, HerdListService],
})
export class PigsModule {}
