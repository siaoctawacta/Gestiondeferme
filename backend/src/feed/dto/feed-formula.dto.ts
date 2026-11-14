import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Trim } from '../../listing/list-helpers';
import { ListQueryDto } from '../../listing/list-query.dto';
import { QueryBool } from './feed-product.dto';

const SPECIES = ['AVICOLE', 'PORCIN'] as const;
const SPECIES_MSG = "L'espèce est invalide";
const PERCENT = 'Le pourcentage doit être compris entre 0 et 100';

export class FeedFormulaQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ enum: SPECIES })
  @IsOptional()
  @IsEnum(SPECIES, { message: SPECIES_MSG })
  species?: (typeof SPECIES)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @QueryBool()
  @IsBoolean({ message: 'Le filtre actif est invalide' })
  active?: boolean;
}

export class FormulaItemDto {
  @ApiProperty()
  @IsString({ message: 'Aliment invalide' })
  @IsNotEmpty({ message: 'Aliment invalide' })
  feedProductId!: string;

  @ApiProperty({ minimum: 0, maximum: 100 })
  @IsNumber({ maxDecimalPlaces: 2 }, { message: PERCENT })
  @Min(0.01, { message: PERCENT })
  @Max(100, { message: PERCENT })
  percentage!: number;
}

export class CreateFeedFormulaDto {
  @ApiProperty()
  @Trim()
  @IsString({ message: 'Le nom est requis' })
  @IsNotEmpty({ message: 'Le nom est requis' })
  @MaxLength(120, { message: 'Le nom est trop long' })
  name!: string;

  @ApiProperty({ enum: SPECIES })
  @IsEnum(SPECIES, { message: SPECIES_MSG })
  species!: (typeof SPECIES)[number];

  @ApiProperty({ example: 'DEMARRAGE' })
  @Trim()
  @IsString({ message: 'La phase est requise' })
  @IsNotEmpty({ message: 'La phase est requise' })
  @MaxLength(60, { message: 'La phase est trop longue' })
  stage!: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean({ message: 'Le statut est invalide' })
  active?: boolean;

  @ApiProperty({ type: [FormulaItemDto] })
  @IsArray({ message: 'Indiquez les ingrédients' })
  @ArrayMinSize(1, { message: 'Indiquez les ingrédients' })
  @ArrayMaxSize(50, { message: 'Trop d’ingrédients' })
  @ValidateNested({ each: true })
  @Type(() => FormulaItemDto)
  items!: FormulaItemDto[];
}

export class UpdateFeedFormulaDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Trim()
  @IsString({ message: 'Le nom est requis' })
  @IsNotEmpty({ message: 'Le nom est requis' })
  @MaxLength(120, { message: 'Le nom est trop long' })
  name?: string;

  @ApiPropertyOptional({ enum: SPECIES })
  @IsOptional()
  @IsEnum(SPECIES, { message: SPECIES_MSG })
  species?: (typeof SPECIES)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @Trim()
  @IsString({ message: 'La phase est requise' })
  @IsNotEmpty({ message: 'La phase est requise' })
  @MaxLength(60, { message: 'La phase est trop longue' })
  stage?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean({ message: 'Le statut est invalide' })
  active?: boolean;

  @ApiPropertyOptional({ type: [FormulaItemDto] })
  @IsOptional()
  @IsArray({ message: 'Indiquez les ingrédients' })
  @ArrayMinSize(1, { message: 'Indiquez les ingrédients' })
  @ArrayMaxSize(50, { message: 'Trop d’ingrédients' })
  @ValidateNested({ each: true })
  @Type(() => FormulaItemDto)
  items?: FormulaItemDto[];
}
