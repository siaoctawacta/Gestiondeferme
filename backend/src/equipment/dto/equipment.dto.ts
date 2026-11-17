import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import {
  NotNull,
  OptionalDay,
  OptionalId,
  OptionalText,
  RequiredText,
} from '../../health/dto/fields';
import { IsDay } from '../../herd/dto/is-day';
import { ListQueryDto } from '../../listing/list-query.dto';
import { CONDITION_LIST, type ConditionValue } from '../equipment-state';

export const EQUIPMENT_TYPES = [
  'COUVEUSE',
  'BALANCE',
  'POMPE',
  'GROUPE_ELECTROGENE',
  'VENTILATEUR',
  'CHAUFFAGE',
  'ABREUVOIR',
  'MANGEOIRE',
  'VEHICULE',
  'AUTRE',
] as const;
export type EquipmentTypeValue = (typeof EQUIPMENT_TYPES)[number];
export const MAINTENANCE_KINDS = ['PREVENTIVE', 'CORRECTIVE'] as const;
export type MaintenanceKindValue = (typeof MAINTENANCE_KINDS)[number];
/** What an intervention may leave a repaired equipment as. */
export const CONDITIONS_AFTER = ['BON', 'A_SURVEILLER'] as const;

const TYPE = "Le type d'équipement est invalide";
const CONDITION = "L'état est invalide";
const KIND = "Le type d'intervention est invalide";
const INTERVAL =
  "L'intervalle doit être un nombre entier de jours supérieur à 0";
const COST = 'Le coût doit être un nombre positif ou nul (2 décimales au plus)';
export const MAX_COST = 1_000_000_000;

/** Optional whole number of days between two maintenances; `null` (PATCH) clears it. */
const OptionalInterval = () =>
  applyDecorators(
    ApiPropertyOptional({ nullable: true }),
    IsOptional(),
    IsInt({ message: INTERVAL }),
    Min(1, { message: INTERVAL }),
    Max(3650, { message: "L'intervalle est trop long" }),
  );

/** Optional cost; `null` (PATCH) stores a free intervention. */
const OptionalCost = () =>
  applyDecorators(
    ApiPropertyOptional({ nullable: true }),
    IsOptional(),
    IsNumber({ maxDecimalPlaces: 2 }, { message: COST }),
    Min(0, { message: COST }),
    Max(MAX_COST, { message: 'Le coût est trop élevé' }),
  );

export class EquipmentQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ enum: EQUIPMENT_TYPES })
  @IsOptional()
  @IsEnum(EQUIPMENT_TYPES, { message: TYPE })
  type?: EquipmentTypeValue;

  /** The retired equipment instead of the equipment in service. */
  @ApiPropertyOptional({ enum: ['true', 'false'] })
  @IsOptional()
  @IsIn(['true', 'false'], { message: 'Filtre « réformés » invalide' })
  retired?: 'true' | 'false';
}

export class CreateEquipmentDto {
  @ApiProperty({ example: 'Pompe forage' })
  @RequiredText(120, 'Le nom')
  name!: string;

  @ApiProperty({ enum: EQUIPMENT_TYPES })
  @IsEnum(EQUIPMENT_TYPES, { message: TYPE })
  type!: EquipmentTypeValue;

  @OptionalId()
  siteId?: string;

  @OptionalId()
  buildingId?: string;

  @OptionalText(80, 'La marque')
  brand?: string;

  @OptionalText(80, 'Le numéro de série')
  serialNumber?: string;

  @OptionalDay()
  purchaseDate?: string;

  @OptionalInterval()
  maintenanceIntervalDays?: number;

  @OptionalDay()
  firstMaintenanceDate?: string;

  @OptionalText(2000, 'La note')
  note?: string;
}

export class UpdateEquipmentDto {
  @ApiPropertyOptional()
  @NotNull()
  @RequiredText(120, 'Le nom')
  name?: string;

  @ApiPropertyOptional({ enum: EQUIPMENT_TYPES })
  @NotNull()
  @IsEnum(EQUIPMENT_TYPES, { message: TYPE })
  type?: EquipmentTypeValue;

  @OptionalId()
  siteId?: string | null;

  @OptionalId()
  buildingId?: string | null;

  @OptionalText(80, 'La marque')
  brand?: string | null;

  @OptionalText(80, 'Le numéro de série')
  serialNumber?: string | null;

  @OptionalDay()
  purchaseDate?: string | null;

  @OptionalInterval()
  maintenanceIntervalDays?: number | null;

  @OptionalDay()
  firstMaintenanceDate?: string | null;

  /** Only `BON` and `A_SURVEILLER` change by hand (the service refuses the rest with its own message). */
  @ApiPropertyOptional({ enum: CONDITION_LIST })
  @NotNull()
  @IsEnum(CONDITION_LIST, { message: CONDITION })
  condition?: ConditionValue;

  @OptionalText(2000, 'La note')
  note?: string | null;
}

export class BreakdownDto {
  @ApiProperty({ example: '2026-11-02' })
  @IsDay()
  date!: string;

  @ApiProperty({ example: 'Moteur grillé' })
  @RequiredText(500, 'La description')
  description!: string;
}

export class RetireDto {
  @ApiProperty({ example: '2026-11-17' })
  @IsDay()
  date!: string;
}

export class MaintenanceQueryDto extends ListQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  equipmentId?: string;

  @ApiPropertyOptional({ enum: MAINTENANCE_KINDS })
  @IsOptional()
  @IsEnum(MAINTENANCE_KINDS, { message: KIND })
  kind?: MaintenanceKindValue;

  @ApiPropertyOptional({ example: '2026-10-01' })
  @IsOptional()
  @IsDay()
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-31' })
  @IsOptional()
  @IsDay()
  to?: string;
}

export class CreateMaintenanceDto {
  @ApiProperty()
  @RequiredText(64, "L'équipement")
  equipmentId!: string;

  @ApiProperty({ enum: MAINTENANCE_KINDS })
  @IsEnum(MAINTENANCE_KINDS, { message: KIND })
  kind!: MaintenanceKindValue;

  @ApiProperty({ example: '2026-11-10' })
  @IsDay()
  date!: string;

  @ApiProperty({ example: 'Vidange' })
  @RequiredText(300, 'La description')
  description!: string;

  @OptionalText(120, "L'intervenant")
  performedBy?: string;

  @OptionalId()
  supplierId?: string;

  /** Read and written only with `finance:read` (otherwise ignored). */
  @OptionalCost()
  cost?: number | null;

  @OptionalDay()
  nextDate?: string;

  /** Repairs the equipment's open breakdown (a corrective intervention only). */
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsBoolean({ message: 'La réparation de la panne est invalide' })
  repairsBreakdown?: boolean | null;

  @ApiPropertyOptional({ enum: CONDITIONS_AFTER })
  @IsOptional()
  @IsIn(CONDITIONS_AFTER, { message: "L'état après intervention est invalide" })
  conditionAfter?: (typeof CONDITIONS_AFTER)[number];
}

export class UpdateMaintenanceDto {
  @ApiPropertyOptional({ enum: MAINTENANCE_KINDS })
  @NotNull()
  @IsEnum(MAINTENANCE_KINDS, { message: KIND })
  kind?: MaintenanceKindValue;

  @ApiPropertyOptional()
  @NotNull()
  @IsDay()
  date?: string;

  @ApiPropertyOptional()
  @NotNull()
  @RequiredText(300, 'La description')
  description?: string;

  @OptionalText(120, "L'intervenant")
  performedBy?: string | null;

  @OptionalId()
  supplierId?: string | null;

  @OptionalCost()
  cost?: number | null;

  @OptionalDay()
  nextDate?: string | null;
}
