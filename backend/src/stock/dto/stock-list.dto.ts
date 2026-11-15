import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNumber, IsOptional, Max, Min } from 'class-validator';
import { ListQueryDto } from '../../listing/list-query.dto';
import { STOCK_LEVELS, type StockLevel } from '../stock-level';
import { STOCK_CATEGORIES, type StockCategoryValue } from './stock-item.dto';

export const MAX_QTY = 10_000_000;
const QTY = 'La quantité doit être un nombre (2 décimales au plus)';

export class StockListQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ enum: STOCK_CATEGORIES })
  @IsOptional()
  @IsEnum(STOCK_CATEGORIES, {
    message: "La catégorie de l'article est invalide",
  })
  category?: StockCategoryValue;

  @ApiPropertyOptional({ enum: STOCK_LEVELS })
  @IsOptional()
  @IsEnum(STOCK_LEVELS, { message: 'Le niveau de stock est invalide' })
  level?: StockLevel;
}

export class SetThresholdsDto {
  @ApiProperty({ minimum: 0 })
  @IsNumber({ maxDecimalPlaces: 2 }, { message: QTY })
  @Min(0, { message: 'Le seuil minimum doit être positif ou nul' })
  @Max(MAX_QTY, { message: 'Le seuil est trop élevé' })
  minQty!: number;

  @ApiPropertyOptional({
    nullable: true,
    description: 'null efface le seuil maximum',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: QTY })
  @Min(0, { message: 'Le seuil maximum doit être positif ou nul' })
  @Max(MAX_QTY, { message: 'Le seuil est trop élevé' })
  maxQty?: number | null;
}
