import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { MAX_LINES, MAX_QUANTITY } from '../../common/limits';
import { IsDay } from '../../herd/dto/is-day';
import { Trim } from '../../listing/list-helpers';
import { ListQueryDto } from '../../listing/list-query.dto';

const LINES = 'Un avoir comporte au moins une ligne';
const REASON = "Le motif de l'avoir est requis";
const QTY = 'La quantité doit être un nombre positif (2 décimales au plus)';

export class CreditNoteQueryDto extends ListQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'Le client est invalide' })
  customerId?: string;

  @ApiPropertyOptional({ example: '2026-11-01' })
  @IsOptional()
  @IsDay()
  from?: string;

  @ApiPropertyOptional({ example: '2026-11-30' })
  @IsOptional()
  @IsDay()
  to?: string;
}

/**
 * One line of a credit note. A line whose amount is already used up (rounding
 * of earlier partial credits) is worth 0: it can ride along with a line that
 * is worth something, but a credit note worth nothing is a 400.
 */
export class CreditLineDto {
  @ApiProperty({ description: 'A line of the invoice being credited' })
  @IsString({ message: 'Ligne de facture invalide' })
  @IsNotEmpty({ message: 'Ligne de facture invalide' })
  lineId!: string;

  @ApiProperty({ minimum: 0.01, description: 'At most what is left to credit' })
  @IsNumber({ maxDecimalPlaces: 2 }, { message: QTY })
  @Min(0.01, { message: QTY })
  @Max(MAX_QUANTITY, { message: 'La quantité est trop élevée' })
  quantity!: number;
}

export class CreateCreditNoteDto {
  @ApiProperty({ example: '2026-11-02' })
  @IsDay()
  date!: string;

  @ApiProperty()
  @Trim()
  @IsString({ message: REASON })
  @IsNotEmpty({ message: REASON })
  @MaxLength(500, { message: 'Le motif est trop long' })
  reason!: string;

  @ApiPropertyOptional({
    default: false,
    description:
      'The goods come back: lots, eggs and articles re-enter their ledgers',
  })
  @ValidateIf((_o, v) => v !== undefined)
  @IsBoolean({ message: 'Le retour des marchandises est invalide' })
  withReturn?: boolean;

  @ApiProperty({ type: [CreditLineDto] })
  @IsArray({ message: LINES })
  @ArrayMinSize(1, { message: LINES })
  @ArrayMaxSize(MAX_LINES, { message: 'Trop de lignes' })
  @ValidateNested({ each: true })
  @Type(() => CreditLineDto)
  lines!: CreditLineDto[];
}
