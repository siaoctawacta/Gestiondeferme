import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { MAX_PAYMENT } from '../../common/limits';
import {
  Activity,
  FinanceCategory,
  FinanceKind,
  Species,
} from '../../generated/prisma/enums';
import { IsDay } from '../../herd/dto/is-day';
import { Trim, TrimOrNull } from '../../listing/list-helpers';
import { ListQueryDto } from '../../listing/list-query.dto';
import { ORIGINS, type Origin } from '../finance-rules';

const AMOUNT = 'Le montant doit être un nombre positif (2 décimales au plus)';
const LABEL = 'Le libellé est requis (120 caractères au plus)';
const KIND = 'Le type est invalide';
const ACTIVITY = "L'activité est invalide";
const CATEGORY = 'La catégorie est invalide';
const LOT = 'Le lot est invalide';
const NOTE = 'La note est invalide';

export class PeriodQueryDto {
  @ApiPropertyOptional({ example: '2026-10-01' })
  @IsOptional()
  @IsDay()
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-31' })
  @IsOptional()
  @IsDay()
  to?: string;
}

export class FinanceEntriesQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ enum: FinanceKind })
  @IsOptional()
  @IsEnum(FinanceKind, { message: KIND })
  kind?: FinanceKind;

  @ApiPropertyOptional({ enum: Activity })
  @IsOptional()
  @IsEnum(Activity, { message: ACTIVITY })
  activity?: Activity;

  @ApiPropertyOptional({ enum: FinanceCategory })
  @IsOptional()
  @IsEnum(FinanceCategory, { message: CATEGORY })
  category?: FinanceCategory;

  @ApiPropertyOptional({ enum: ORIGINS })
  @IsOptional()
  @IsIn(ORIGINS, { message: "L'origine est invalide" })
  origin?: Origin;

  @ApiPropertyOptional({ example: '2026-10-01' })
  @IsOptional()
  @IsDay()
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-31' })
  @IsOptional()
  @IsDay()
  to?: string;
}

export class LotsQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ example: '2026-10-01' })
  @IsOptional()
  @IsDay()
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-31' })
  @IsOptional()
  @IsDay()
  to?: string;

  @ApiPropertyOptional({ enum: Species })
  @IsOptional()
  @IsEnum(Species, { message: "L'espèce est invalide" })
  species?: Species;
}

export class LotOptionsQueryDto {
  @ApiProperty({ enum: ['AVICOLE', 'PORCIN'] })
  @IsIn(['AVICOLE', 'PORCIN'], { message: ACTIVITY })
  activity!: 'AVICOLE' | 'PORCIN';
}

export class CreateFinanceEntryDto {
  @ApiProperty({ example: '2026-10-08' })
  @IsDay()
  date!: string;

  @ApiProperty({ enum: FinanceKind })
  @IsEnum(FinanceKind, { message: KIND })
  kind!: FinanceKind;

  @ApiProperty()
  @Trim()
  @IsString({ message: LABEL })
  @IsNotEmpty({ message: LABEL })
  @MaxLength(120, { message: LABEL })
  label!: string;

  @ApiProperty({ enum: Activity })
  @IsEnum(Activity, { message: ACTIVITY })
  activity!: Activity;

  @ApiProperty({ enum: FinanceCategory })
  @IsEnum(FinanceCategory, { message: CATEGORY })
  category!: FinanceCategory;

  @ApiProperty({ minimum: 0.01, description: 'FCFA' })
  @IsNumber({ maxDecimalPlaces: 2 }, { message: AMOUNT })
  @Min(0.01, { message: AMOUNT })
  @Max(MAX_PAYMENT, { message: 'Le montant est trop élevé' })
  amount!: number;

  @ApiPropertyOptional({
    nullable: true,
    description: 'An expense of the poultry or pig activity only',
  })
  @IsOptional()
  @IsString({ message: LOT })
  @IsNotEmpty({ message: LOT })
  batchId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @TrimOrNull()
  @IsString({ message: NOTE })
  @MaxLength(500, { message: 'La note est trop longue (500 caractères)' })
  note?: string | null;
}

const present = (_o: unknown, v: unknown) => v !== undefined;

/** Every field optional; the non-nullable ones refuse `null` (400, never a 500). */
export class UpdateFinanceEntryDto {
  @ApiPropertyOptional()
  @ValidateIf(present)
  @IsDay()
  date?: string;

  @ApiPropertyOptional({ enum: FinanceKind })
  @ValidateIf(present)
  @IsEnum(FinanceKind, { message: KIND })
  kind?: FinanceKind;

  @ApiPropertyOptional()
  @ValidateIf(present)
  @Trim()
  @IsString({ message: LABEL })
  @IsNotEmpty({ message: LABEL })
  @MaxLength(120, { message: LABEL })
  label?: string;

  @ApiPropertyOptional({ enum: Activity })
  @ValidateIf(present)
  @IsEnum(Activity, { message: ACTIVITY })
  activity?: Activity;

  @ApiPropertyOptional({ enum: FinanceCategory })
  @ValidateIf(present)
  @IsEnum(FinanceCategory, { message: CATEGORY })
  category?: FinanceCategory;

  @ApiPropertyOptional({ minimum: 0.01 })
  @ValidateIf(present)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: AMOUNT })
  @Min(0.01, { message: AMOUNT })
  @Max(MAX_PAYMENT, { message: 'Le montant est trop élevé' })
  amount?: number;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString({ message: LOT })
  @IsNotEmpty({ message: LOT })
  batchId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @TrimOrNull()
  @IsString({ message: NOTE })
  @MaxLength(500, { message: 'La note est trop longue (500 caractères)' })
  note?: string | null;
}
