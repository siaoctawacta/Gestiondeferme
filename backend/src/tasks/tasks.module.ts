import { Module } from '@nestjs/common';
import { IndicatorsModule } from '../indicators/indicators.module';
import { TaskAlertsService } from './task-alerts.service';
import { TaskReads } from './task-reads.service';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

/**
 * Farm tasks: workflow, recurrence, proof photo. Registers the late-task alert
 * rule in `IndicatorsModule`'s registry and exports `TaskReads`, the figures
 * the dashboard and the reports read.
 */
@Module({
  imports: [IndicatorsModule],
  controllers: [TasksController],
  providers: [TasksService, TaskAlertsService, TaskReads],
  exports: [TaskReads],
})
export class TasksModule {}
