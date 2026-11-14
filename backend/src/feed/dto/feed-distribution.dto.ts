import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  MaxLength,
} from 'class-validator';
import { IsDay } from '../../herd/dto/is-day';
import { Trim } from '../../listing/list-helpers';
import { ListQueryDto } from '../../listing/list-query.dto';

const QTY = 'La quantité doit être un nombre positif (2 décimales au plus)';
const WATER =
  "Le volume d'eau doit être un nombre positif (2 décimales au plus)";
const ID = 'Identifiant invalide';
export const MAX_QTY = 10_000_000;

/** Filters shared by the distribution and water lists. */
export class FeedListQueryDto extends ListQueryDto {
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
  @IsString({ message: 'Le lot est invalide' })
  batchId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'Le bâtiment est invalide' })
  buildingId?: string;
}

export class CreateFeedDistributionDto {
  @ApiPropertyOptional({ description: 'Exactly one of batchId / buildingId' })
  @IsOptional()
  @IsString({ message: ID })
  @IsNotEmpty({ message: ID })
  batchId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: ID })
  @IsNotEmpty({ message: ID })
  buildingId?: string;

  @ApiProperty({ example: '2026-11-02' })
  @IsDay()
  date!: string;

  @ApiPropertyOptional({
    description: 'Exactly one of feedProductId / formulaId',
  })
  @IsOptional()
  @IsString({ message: ID })
  @IsNotEmpty({ message: ID })
  feedProductId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: ID })
  @IsNotEmpty({ message: ID })
  formulaId?: string;

  @ApiProperty({ minimum: 0 })
  @IsNumber({ maxDecimalPlaces: 2 }, { message: QTY })
  @IsPositive({ message: QTY })
  @Max(MAX_QTY, { message: 'La quantité est trop élevée' })
  quantityKg!: number;

  @ApiPropertyOptional({
    description: 'Eau du jour pour la même cible (créée ou mise à jour)',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: WATER })
  @IsPositive({ message: WATER })
  @Max(MAX_QTY, { message: "Le volume d'eau est trop élevé" })
  waterLiters?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Trim()
  @IsString({ message: 'La note est invalide' })
  @MaxLength(1000, { message: 'La note est trop longue' })
  note?: string;
}

export class UpdateFeedDistributionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsDay()
  date?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: ID })
  @IsNotEmpty({ message: ID })
  feedProductId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: ID })
  @IsNotEmpty({ message: ID })
  formulaId?: string;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: QTY })
  @IsPositive({ message: QTY })
  @Max(MAX_QTY, { message: 'La quantité est trop élevée' })
  quantityKg?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: WATER })
  @IsPositive({ message: WATER })
  @Max(MAX_QTY, { message: "Le volume d'eau est trop élevé" })
  waterLiters?: number;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Trim()
  @IsString({ message: 'La note est invalide' })
  @MaxLength(1000, { message: 'La note est trop longue' })
  note?: string | null;
}
