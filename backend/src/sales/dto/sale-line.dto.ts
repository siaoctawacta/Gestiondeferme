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
import { Trim } from '../../listing/list-helpers';
import { SaleLineKind } from '../../generated/prisma/enums';
import { MAX_PRICE, MAX_QUANTITY } from '../../common/limits';

const ID = 'Identifiant invalide';
const QTY = 'La quantité doit être un nombre positif (2 décimales au plus)';
const PRICE =
  'Le prix unitaire doit être un nombre positif ou nul (2 décimales au plus)';
const WEIGHT = 'Le poids doit être un nombre positif (2 décimales au plus)';

/** One sale line (quote, invoice draft): it names its source; the server derives the rest. */
export class SaleLineDto {
  @ApiProperty({ enum: SaleLineKind })
  @IsEnum(SaleLineKind, { message: 'Le type de ligne est invalide' })
  kind!: SaleLineKind;

  @ApiPropertyOptional({ nullable: true, description: 'LOT and OEUFS lines' })
  @IsOptional()
  @IsString({ message: ID })
  @IsNotEmpty({ message: ID })
  batchId?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'ANIMAL lines' })
  @IsOptional()
  @IsString({ message: ID })
  @IsNotEmpty({ message: ID })
  animalId?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'ARTICLE lines' })
  @IsOptional()
  @IsString({ message: ID })
  @IsNotEmpty({ message: ID })
  stockItemId?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Required for a SERVICE; else defaults to a name derived from the source',
  })
  @IsOptional()
  @Trim()
  @IsString({ message: 'La désignation est invalide' })
  @MaxLength(200, { message: 'La désignation est trop longue' })
  designation?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'OEUFS: `PLATEAU` (default, eggsPerTray eggs) or `OEUF`; ARTICLE: always the article unit (a unit sent is ignored); refused (400) on LOT, ANIMAL and SERVICE lines',
  })
  @IsOptional()
  @Trim()
  @IsString({ message: "L'unité est invalide" })
  @MaxLength(20, { message: "L'unité est trop longue" })
  unit?: string | null;

  @ApiProperty({ minimum: 0.01 })
  @IsNumber({ maxDecimalPlaces: 2 }, { message: QTY })
  @Min(0.01, { message: QTY })
  @Max(MAX_QUANTITY, { message: 'La quantité est trop élevée' })
  quantity!: number;

  @ApiProperty({ minimum: 0, description: 'FCFA per unit' })
  @IsNumber({ maxDecimalPlaces: 2 }, { message: PRICE })
  @Min(0, { message: PRICE })
  @Max(MAX_PRICE, { message: 'Le prix unitaire est trop élevé' })
  unitPrice!: number;

  @ApiPropertyOptional({ nullable: true, description: 'LOT and ANIMAL only' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: WEIGHT })
  @Min(0.01, { message: WEIGHT })
  @Max(MAX_QUANTITY, { message: 'Le poids est trop élevé' })
  weightKg?: number | null;
}
