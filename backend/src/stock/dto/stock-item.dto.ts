import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { Trim } from '../../listing/list-helpers';
import { ListQueryDto } from '../../listing/list-query.dto';
import { QueryBool } from '../../listing/query-bool';

export const STOCK_CATEGORIES = [
  'ALIMENT',
  'MEDICAMENT',
  'VACCIN',
  'MATERIEL',
  'CONSOMMABLE',
] as const;
export type StockCategoryValue = (typeof STOCK_CATEGORIES)[number];

const CATEGORY = "La catégorie de l'article est invalide";

export class StockItemQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ enum: STOCK_CATEGORIES })
  @IsOptional()
  @IsEnum(STOCK_CATEGORIES, { message: CATEGORY })
  category?: StockCategoryValue;

  @ApiPropertyOptional()
  @IsOptional()
  @QueryBool()
  @IsBoolean({ message: 'Le filtre actif est invalide' })
  active?: boolean;
}

export class CreateStockItemDto {
  @ApiProperty()
  @Trim()
  @IsString({ message: 'Le nom est requis' })
  @IsNotEmpty({ message: 'Le nom est requis' })
  @MaxLength(120, { message: 'Le nom est trop long' })
  name!: string;

  @ApiProperty({ enum: STOCK_CATEGORIES })
  @IsEnum(STOCK_CATEGORIES, { message: CATEGORY })
  category!: StockCategoryValue;

  @ApiProperty({ example: 'kg' })
  @Trim()
  @IsString({ message: "L'unité est requise" })
  @IsNotEmpty({ message: "L'unité est requise" })
  @MaxLength(20, { message: "L'unité est trop longue" })
  unit!: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean({ message: 'Le statut est invalide' })
  active?: boolean;
}

export class UpdateStockItemDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Trim()
  @IsString({ message: 'Le nom est requis' })
  @IsNotEmpty({ message: 'Le nom est requis' })
  @MaxLength(120, { message: 'Le nom est trop long' })
  name?: string;

  @ApiPropertyOptional({ enum: STOCK_CATEGORIES })
  @IsOptional()
  @IsEnum(STOCK_CATEGORIES, { message: CATEGORY })
  category?: StockCategoryValue;

  @ApiPropertyOptional()
  @IsOptional()
  @Trim()
  @IsString({ message: "L'unité est requise" })
  @IsNotEmpty({ message: "L'unité est requise" })
  @MaxLength(20, { message: "L'unité est trop longue" })
  unit?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean({ message: 'Le statut est invalide' })
  active?: boolean;
}
