import { Module } from '@nestjs/common';
import { HerdModule } from '../../herd/herd.module';
import { AdminModule } from '../admin.module';
import { BuildingOverviewController } from './building-overview.controller';
import { BuildingOverviewService } from './building-overview.service';

/**
 * A leaf: it reads the buildings (`AdminModule`) and the herd ledger, and the tables of equipment,
 * tasks and health through the database, so none of those modules has to import `admin` back.
 */
@Module({
  imports: [AdminModule, HerdModule],
  controllers: [BuildingOverviewController],
  providers: [BuildingOverviewService],
})
export class BuildingOverviewModule {}
