import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Trim } from '../../listing/list-helpers';
import { IsDay } from './is-day';

/** Event types a person may enter by hand; transfers have their own route. */
export const MANUAL_EVENT_TYPES = [
  'MORTALITE',
  'VENTE',
  'REFORME',
  'ENTREE',
  'NAISSANCE',
] as const;
export type ManualEventType = (typeof MANUAL_EVENT_TYPES)[number];

const QUANTITY = 'La quantité doit être un nombre entier supérieur à 0';
const TYPE = "Type d'événement invalide";

export class CreateEventDto {
  @ApiProperty({ enum: MANUAL_EVENT_TYPES })
  @IsEnum(MANUAL_EVENT_TYPES, { message: TYPE })
  type!: ManualEventType;

  @ApiProperty({ example: '2026-11-02' })
  @IsDay()
  date!: string;

  @ApiProperty({ minimum: 1 })
  @IsInt({ message: QUANTITY })
  @Min(1, { message: QUANTITY })
  @Max(10_000_000, { message: 'La quantité est trop élevée' })
  quantity!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Trim()
  @IsString({ message: 'La cause est invalide' })
  @MaxLength(200, { message: 'La cause est trop longue' })
  cause?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Trim()
  @IsString({ message: 'La note est invalide' })
  @MaxLength(1000, { message: 'La note est trop longue' })
  note?: string;
}

export class UpdateEventDto {
  @ApiPropertyOptional({ enum: MANUAL_EVENT_TYPES })
  @IsOptional()
  @IsEnum(MANUAL_EVENT_TYPES, { message: TYPE })
  type?: ManualEventType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDay()
  date?: string;

  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @IsInt({ message: QUANTITY })
  @Min(1, { message: QUANTITY })
  @Max(10_000_000, { message: 'La quantité est trop élevée' })
  quantity?: number;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Trim()
  @IsString({ message: 'La cause est invalide' })
  @MaxLength(200, { message: 'La cause est trop longue' })
  cause?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Trim()
  @IsString({ message: 'La note est invalide' })
  @MaxLength(1000, { message: 'La note est trop longue' })
  note?: string | null;
}

export class TransferDto {
  @ApiProperty()
  @IsString({ message: 'Le bâtiment de destination est requis' })
  @IsNotEmpty({ message: 'Le bâtiment de destination est requis' })
  toBuildingId!: string;

  @ApiProperty()
  @IsDay()
  date!: string;

  @ApiProperty({ minimum: 1 })
  @IsInt({ message: QUANTITY })
  @Min(1, { message: QUANTITY })
  @Max(10_000_000, { message: 'La quantité est trop élevée' })
  quantity!: number;
}
