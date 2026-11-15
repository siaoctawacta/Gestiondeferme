import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { IsDay } from '../../herd/dto/is-day';
import { Trim } from '../../listing/list-helpers';
import { ListQueryDto } from '../../listing/list-query.dto';
import { MAX_LINES } from '../../purchases/dto/purchase.dto';
import { SaleLineDto } from './sale-line.dto';

const LINES = 'Un devis comporte au moins une ligne';
const CUSTOMER = 'Le client est requis';
const NOTE = 'La note est invalide';

export class QuoteQueryDto extends ListQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'Le client est invalide' })
  customerId?: string;
}

export class CreateQuoteDto {
  @ApiProperty()
  @IsString({ message: CUSTOMER })
  @IsNotEmpty({ message: CUSTOMER })
  customerId!: string;

  @ApiProperty({ example: '2026-11-02' })
  @IsDay()
  date!: string;

  @ApiPropertyOptional({
    nullable: true,
    example: '2026-11-17',
    description: 'Last day the quote is valid (not before `date`)',
  })
  @IsOptional()
  @IsDay()
  validUntil?: string | null;

  @ApiProperty({ type: [SaleLineDto] })
  @IsArray({ message: LINES })
  @ArrayMinSize(1, { message: LINES })
  @ArrayMaxSize(MAX_LINES, { message: 'Trop de lignes' })
  @ValidateNested({ each: true })
  @Type(() => SaleLineDto)
  lines!: SaleLineDto[];

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Trim()
  @IsString({ message: NOTE })
  @MaxLength(1000, { message: 'La note est trop longue' })
  note?: string | null;
}

/** Only a draft can be edited; `lines` replaces the whole list. */
export class UpdateQuoteDto {
  @ApiPropertyOptional()
  @ValidateIf((_o, v) => v !== undefined)
  @IsString({ message: 'Le client est invalide' })
  @IsNotEmpty({ message: 'Le client est invalide' })
  customerId?: string;

  @ApiPropertyOptional()
  @ValidateIf((_o, v) => v !== undefined)
  @IsDay()
  date?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsDay()
  validUntil?: string | null;

  @ApiPropertyOptional({ type: [SaleLineDto] })
  @ValidateIf((_o, v) => v !== undefined)
  @IsArray({ message: LINES })
  @ArrayMinSize(1, { message: LINES })
  @ArrayMaxSize(MAX_LINES, { message: 'Trop de lignes' })
  @ValidateNested({ each: true })
  @Type(() => SaleLineDto)
  lines?: SaleLineDto[];

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Trim()
  @IsString({ message: NOTE })
  @MaxLength(1000, { message: 'La note est trop longue' })
  note?: string | null;
}
