import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { IsDay } from '../../herd/dto/is-day';
import { Trim } from '../../listing/list-helpers';
import { ListQueryDto } from '../../listing/list-query.dto';
import { MAX_QTY } from './stock-list.dto';

export const MANUAL_TYPES = ['ENTREE', 'SORTIE', 'AJUSTEMENT'] as const;
export type ManualType = (typeof MANUAL_TYPES)[number];
export const REASONS = [
  'ACHAT',
  'CONSOMMATION',
  'TRAITEMENT',
  'INVENTAIRE',
  'PERTE',
  'AUTRE',
] as const;
export type ReasonValue = (typeof REASONS)[number];

/** The reasons a hand-entered movement of each type may carry. */
export const MANUAL_REASONS: Record<ManualType, ReasonValue[]> = {
  ENTREE: ['ACHAT', 'AUTRE'],
  SORTIE: ['PERTE', 'CONSOMMATION', 'AUTRE'],
  AJUSTEMENT: ['INVENTAIRE', 'AUTRE'],
};

export const MAX_UNIT_COST = 10_000_000;
const QTY = 'La quantité doit être un nombre non nul (2 décimales au plus)';
const COST = 'Le coût doit être un nombre positif ou nul (2 décimales au plus)';
const ID = 'Identifiant invalide';
const NOTE = 'La note est invalide';

export class MovementQueryDto extends ListQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'Article invalide' })
  itemId?: string;

  @ApiPropertyOptional({ example: '2026-11-01' })
  @IsOptional()
  @IsDay()
  from?: string;

  @ApiPropertyOptional({ example: '2026-11-30' })
  @IsOptional()
  @IsDay()
  to?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEnum(['ENTREE', 'SORTIE', 'AJUSTEMENT'], {
    message: 'Le type de mouvement est invalide',
  })
  type?: ManualType;
}

export class CreateMovementDto {
  @ApiProperty()
  @IsString({ message: 'Article invalide' })
  @IsNotEmpty({ message: 'Article invalide' })
  itemId!: string;

  @ApiProperty({ enum: MANUAL_TYPES })
  @IsEnum(MANUAL_TYPES, { message: 'Le type de mouvement est invalide' })
  type!: ManualType;

  @ApiProperty({ example: '2026-11-02' })
  @IsDay()
  date!: string;

  @ApiProperty({
    description:
      'Positive pour une entrée ou une sortie (le sens vient du type) ; signée pour un ajustement',
  })
  @IsNumber({ maxDecimalPlaces: 2 }, { message: QTY })
  @Min(-MAX_QTY, { message: 'La quantité est trop élevée' })
  @Max(MAX_QTY, { message: 'La quantité est trop élevée' })
  quantity!: number;

  @ApiPropertyOptional({
    description:
      'Obligatoire pour une entrée ; facultatif pour un ajustement positif (sinon au coût moyen) ; interdit pour une sortie',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: COST })
  @Min(0, { message: COST })
  @Max(MAX_UNIT_COST, { message: 'Le coût est trop élevé' })
  unitCost?: number;

  @ApiProperty({ enum: REASONS })
  @IsEnum(REASONS, { message: 'Le motif est invalide' })
  reason!: ReasonValue;

  @ApiPropertyOptional({
    description:
      'Lot dont sort le stock (sinon le plus proche de sa péremption)',
  })
  @IsOptional()
  @IsString({ message: ID })
  @IsNotEmpty({ message: ID })
  stockBatchId?: string;

  @ApiPropertyOptional({ description: 'Entrée : crée un lot' })
  @IsOptional()
  @Trim()
  @IsString({ message: 'Le numéro de lot est invalide' })
  @IsNotEmpty({ message: 'Le numéro de lot est invalide' })
  @MaxLength(60, { message: 'Le numéro de lot est trop long' })
  lotNumber?: string;

  @ApiPropertyOptional({ description: 'Entrée : péremption du lot créé' })
  @IsOptional()
  @IsDay()
  expiryDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Trim()
  @IsString({ message: NOTE })
  @MaxLength(1000, { message: 'La note est trop longue' })
  note?: string;
}

export class UpdateMovementDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsDay()
  date?: string;

  @ApiPropertyOptional({
    description: 'Même convention que la création ; le sens ne change pas',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: QTY })
  @Min(-MAX_QTY, { message: 'La quantité est trop élevée' })
  @Max(MAX_QTY, { message: 'La quantité est trop élevée' })
  quantity?: number;

  @ApiPropertyOptional({ description: 'Entrées seulement' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: COST })
  @Min(0, { message: COST })
  @Max(MAX_UNIT_COST, { message: 'Le coût est trop élevé' })
  unitCost?: number;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Trim()
  @IsString({ message: NOTE })
  @MaxLength(1000, { message: 'La note est trop longue' })
  note?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Lot de cette entrée' })
  @IsOptional()
  @Trim()
  @IsString({ message: 'Le numéro de lot est invalide' })
  @IsNotEmpty({ message: 'Le numéro de lot est invalide' })
  @MaxLength(60, { message: 'Le numéro de lot est trop long' })
  lotNumber?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Péremption du lot de cette entrée',
  })
  @IsOptional()
  @IsDay()
  expiryDate?: string | null;
}
