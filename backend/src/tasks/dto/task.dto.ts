import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsIn, IsOptional, IsString, Matches } from 'class-validator';
import {
  NotNull,
  OptionalId,
  OptionalText,
  RequiredText,
} from '../../health/dto/fields';
import { IsDay } from '../../herd/dto/is-day';
import { Trim } from '../../listing/list-helpers';
import { ListQueryDto } from '../../listing/list-query.dto';

export const TASK_PRIORITIES = ['NORMALE', 'HAUTE', 'URGENTE'] as const;
export const TASK_RECURRENCES = [
  'AUCUNE',
  'QUOTIDIENNE',
  'HEBDOMADAIRE',
  'MENSUELLE',
] as const;
const PRIORITY = 'La priorité est invalide';
const RECURRENCE = 'La récurrence est invalide';
const TIME = "L'heure est invalide (HH:mm)";

/** Optional `HH:mm`; `null` (PATCH) clears it. */
const OptionalTime = () =>
  applyDecorators(
    ApiPropertyOptional({ example: '06:30', nullable: true }),
    IsOptional(),
    Trim(),
    IsString({ message: TIME }),
    Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: TIME }),
  );

export class TaskQueryDto extends ListQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  assigneeId?: string;

  /** Only the tasks assigned to the employee linked to the caller. */
  @ApiPropertyOptional({ enum: ['true', 'false'] })
  @IsOptional()
  @IsIn(['true', 'false'], { message: 'Filtre « mes tâches » invalide' })
  mine?: 'true' | 'false';

  @ApiPropertyOptional({ enum: TASK_PRIORITIES })
  @IsOptional()
  @IsEnum(TASK_PRIORITIES, { message: PRIORITY })
  priority?: (typeof TASK_PRIORITIES)[number];

  @ApiPropertyOptional({ example: '2026-10-01' })
  @IsOptional()
  @IsDay()
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-31' })
  @IsOptional()
  @IsDay()
  to?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  batchId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  buildingId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  equipmentId?: string;
}

export class CreateTaskDto {
  @ApiProperty({ example: 'Nettoyage Porcherie 2' })
  @RequiredText(160, 'Le titre')
  title!: string;

  @OptionalText(2000, 'La description')
  description?: string;

  @OptionalId()
  assigneeId?: string;

  @ApiProperty({ example: '2026-10-23' })
  @IsDay()
  dueDate!: string;

  @OptionalTime()
  dueTime?: string;

  @ApiPropertyOptional({ enum: TASK_PRIORITIES, default: 'NORMALE' })
  @NotNull()
  @IsEnum(TASK_PRIORITIES, { message: PRIORITY })
  priority?: (typeof TASK_PRIORITIES)[number];

  @ApiPropertyOptional({ enum: TASK_RECURRENCES, default: 'AUCUNE' })
  @NotNull()
  @IsEnum(TASK_RECURRENCES, { message: RECURRENCE })
  recurrence?: (typeof TASK_RECURRENCES)[number];

  @OptionalId()
  batchId?: string;

  @OptionalId()
  buildingId?: string;

  @OptionalId()
  equipmentId?: string;
}

export class UpdateTaskDto {
  @ApiPropertyOptional()
  @NotNull()
  @RequiredText(160, 'Le titre')
  title?: string;

  @OptionalText(2000, 'La description')
  description?: string | null;

  @OptionalId()
  assigneeId?: string | null;

  @ApiPropertyOptional({ example: '2026-10-23' })
  @NotNull()
  @IsDay()
  dueDate?: string;

  @OptionalTime()
  dueTime?: string | null;

  @ApiPropertyOptional({ enum: TASK_PRIORITIES })
  @NotNull()
  @IsEnum(TASK_PRIORITIES, { message: PRIORITY })
  priority?: (typeof TASK_PRIORITIES)[number];

  @ApiPropertyOptional({ enum: TASK_RECURRENCES })
  @NotNull()
  @IsEnum(TASK_RECURRENCES, { message: RECURRENCE })
  recurrence?: (typeof TASK_RECURRENCES)[number];

  @OptionalId()
  batchId?: string | null;

  @OptionalId()
  buildingId?: string | null;

  @OptionalId()
  equipmentId?: string | null;
}

export class CompleteTaskDto {
  @ApiPropertyOptional({
    example: '2026-11-14',
    description: 'Day done (default today)',
  })
  @NotNull()
  @IsDay()
  date?: string;
}
