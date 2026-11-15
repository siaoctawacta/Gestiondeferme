import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { IsDay } from '../../herd/dto/is-day';
import { Trim } from '../../listing/list-helpers';
import { MAX_QTY } from './stock-list.dto';

const NOTE = 'La note est invalide';

export class CreateInventoryDto {
  @ApiProperty({ example: '2026-11-02' })
  @IsDay()
  date!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Trim()
  @IsString({ message: NOTE })
  @MaxLength(1000, { message: 'La note est trop longue' })
  note?: string;
}

export class InventoryLineDto {
  @ApiProperty()
  @IsString({ message: 'Article invalide' })
  @IsNotEmpty({ message: 'Article invalide' })
  itemId!: string;

  @ApiProperty({ minimum: 0 })
  @IsNumber(
    { maxDecimalPlaces: 2 },
    {
      message: 'La quantité comptée doit être un nombre (2 décimales au plus)',
    },
  )
  @Min(0, { message: 'La quantité comptée doit être positive ou nulle' })
  @Max(MAX_QTY, { message: 'La quantité est trop élevée' })
  countedQty!: number;
}

/**
 * The lines replace the draft's lines wholesale. The theoretical quantity shown
 * with each line is the one at the session date when the lines are saved;
 * validation recomputes it (under the stock locks) and overwrites it before
 * writing the adjustments.
 */
export class SaveInventoryLinesDto {
  @ApiProperty({ type: [InventoryLineDto] })
  @IsArray({ message: 'Les lignes sont invalides' })
  @ArrayMaxSize(1000, { message: "Trop de lignes d'inventaire" })
  @ValidateNested({ each: true })
  @Type(() => InventoryLineDto)
  lines!: InventoryLineDto[];
}
