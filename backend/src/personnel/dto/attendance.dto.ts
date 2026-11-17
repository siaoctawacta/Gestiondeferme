import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { NotNull, OptionalText } from '../../health/dto/fields';
import { IsDay } from '../../herd/dto/is-day';
import { ListQueryDto } from '../../listing/list-query.dto';

export const ATTENDANCE_STATUSES = [
  'PRESENT',
  'ABSENT',
  'CONGE',
  'MALADIE',
] as const;
export type AttendanceStatusValue = (typeof ATTENDANCE_STATUSES)[number];
const STATUS = 'Le statut est invalide';
const HOURS =
  'Les heures doivent être comprises entre 0,01 et 24 (2 décimales au plus)';
const EMPLOYEE = 'Employé invalide';

/** Optional hours; `null` (PATCH) clears them. */
const OptionalHours = () =>
  applyDecorators(
    ApiPropertyOptional({ nullable: true }),
    IsOptional(),
    IsNumber({ maxDecimalPlaces: 2 }, { message: HOURS }),
    Min(0.01, { message: HOURS }),
    Max(24, { message: HOURS }),
  );

const EmployeeId = () =>
  applyDecorators(
    ApiProperty(),
    IsString({ message: EMPLOYEE }),
    IsNotEmpty({ message: EMPLOYEE }),
  );

export class AttendanceQueryDto extends ListQueryDto {
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
  @IsString({ message: EMPLOYEE })
  employeeId?: string;
}

export class CreateAttendanceDto {
  @EmployeeId()
  employeeId!: string;

  @ApiProperty({ example: '2026-10-20' })
  @IsDay()
  date!: string;

  @ApiProperty({ enum: ATTENDANCE_STATUSES })
  @IsEnum(ATTENDANCE_STATUSES, { message: STATUS })
  status!: AttendanceStatusValue;

  @OptionalHours()
  hours?: number;

  @OptionalText(500, 'La note')
  note?: string;
}

export class UpdateAttendanceDto {
  @ApiPropertyOptional({ enum: ATTENDANCE_STATUSES })
  @NotNull()
  @IsEnum(ATTENDANCE_STATUSES, { message: STATUS })
  status?: AttendanceStatusValue;

  @OptionalHours()
  hours?: number | null;

  @OptionalText(500, 'La note')
  note?: string | null;
}

export class DayEntryDto {
  @EmployeeId()
  employeeId!: string;

  @ApiProperty({ enum: ATTENDANCE_STATUSES })
  @IsEnum(ATTENDANCE_STATUSES, { message: STATUS })
  status!: AttendanceStatusValue;

  @OptionalHours()
  hours?: number;

  @OptionalText(500, 'La note')
  note?: string;
}

export const MAX_DAY_ENTRIES = 200;

export class AttendanceDayDto {
  @ApiProperty({ example: '2026-10-20' })
  @IsDay()
  date!: string;

  @ApiProperty({ type: [DayEntryDto] })
  @IsArray({ message: 'La feuille du jour est invalide' })
  @ArrayMinSize(1, { message: 'La feuille du jour est vide' })
  @ArrayMaxSize(MAX_DAY_ENTRIES, {
    message: 'La feuille du jour est trop longue',
  })
  @ValidateNested({ each: true })
  @Type(() => DayEntryDto)
  entries!: DayEntryDto[];
}
