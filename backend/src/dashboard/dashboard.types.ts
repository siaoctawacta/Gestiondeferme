import { ApiProperty } from '@nestjs/swagger';

/** The activity of a figure, as the finance enum (the screens label it: Avicole, Porcin, Général). */
export const ACTIVITIES = ['AVICOLE', 'PORCIN', 'GENERAL'] as const;
export type Activity = (typeof ACTIVITIES)[number];
export const ALERT_LEVELS = ['A_VOIR', 'URGENT'] as const;
export type AlertLevel = (typeof ALERT_LEVELS)[number];
export const TASK_PRIORITIES = ['NORMALE', 'HAUTE', 'URGENTE'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export class TasksDto {
  @ApiProperty() done!: number;
  @ApiProperty() pending!: number;
}

export class KpisDto {
  @ApiProperty() poultryAlive!: number;
  @ApiProperty() activePoultryBatches!: number;
  @ApiProperty() pigs!: number;
  @ApiProperty() eggsLastDay!: number;
  @ApiProperty({ type: Number, nullable: true }) layingRate!: number | null;
  @ApiProperty({ type: Number, nullable: true }) mortalityRate!: number | null;
}

export class EggPointDto {
  @ApiProperty({ description: 'Recorded day, YYYY-MM-DD' }) date!: string;
  @ApiProperty() eggs!: number;
}

export class ProfitabilityDto {
  @ApiProperty() revenue!: number;
  @ApiProperty() expenses!: number;
  @ApiProperty() margin!: number;
  @ApiProperty({ type: Number, nullable: true }) marginPct!: number | null;
  @ApiProperty({ description: 'Créances clients' }) receivables!: number;
}

export class ActivityTotalsDto {
  @ApiProperty({ enum: ACTIVITIES }) activity!: Activity;
  @ApiProperty() revenue!: number;
  @ApiProperty() expenses!: number;
  @ApiProperty({ description: 'revenue − expenses, computed by the API' })
  margin!: number;
}

export class AlertItemDto {
  @ApiProperty() key!: string;
  @ApiProperty() title!: string;
  @ApiProperty() detail!: string;
  @ApiProperty({ enum: ALERT_LEVELS }) level!: AlertLevel;
  @ApiProperty() module!: string;
  @ApiProperty({
    type: [String],
    description: 'Every module the role must read to see the alert',
  })
  modules!: string[];
}

export class AlertsDto {
  @ApiProperty() total!: number;
  @ApiProperty({ type: [AlertItemDto] }) items!: AlertItemDto[];
}

export class UpcomingTaskDto {
  @ApiProperty() id!: string;
  @ApiProperty() title!: string;
  @ApiProperty() assignee!: string;
  @ApiProperty() dueDate!: string;
  @ApiProperty({ enum: TASK_PRIORITIES }) priority!: TaskPriority;
}

export class DashboardDto {
  @ApiProperty() farmName!: string;
  @ApiProperty({ type: TasksDto }) tasks!: TasksDto;
  @ApiProperty({ type: KpisDto }) kpis!: KpisDto;
  @ApiProperty({ type: [EggPointDto], description: 'Last 5 recorded days' })
  eggSeries!: EggPointDto[];
  @ApiProperty({
    type: ProfitabilityDto,
    nullable: true,
    description: 'Month to date; null for a role without finance read',
  })
  profitability!: ProfitabilityDto | null;
  @ApiProperty() activeBuildings!: number;
  @ApiProperty({ description: 'Last recorded day' }) feedDistributedKg!: number;
  @ApiProperty({ description: 'Last recorded day' }) waterConsumedL!: number;
  @ApiProperty({
    type: [ActivityTotalsDto],
    nullable: true,
    description:
      'Month to date per activity; null for a role without finance read',
  })
  revenueVsExpenses!: ActivityTotalsDto[] | null;
  @ApiProperty({ type: AlertsDto }) alerts!: AlertsDto;
  @ApiProperty({ type: [UpcomingTaskDto] }) upcomingTasks!: UpcomingTaskDto[];
}
