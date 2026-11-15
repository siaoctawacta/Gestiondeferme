import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
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
import { MAX_LINES, MAX_PAYMENT } from '../../common/limits';
import { IsDay } from '../../herd/dto/is-day';
import { Trim } from '../../listing/list-helpers';
import { ListQueryDto } from '../../listing/list-query.dto';
import { PAYMENT_METHODS } from '../../purchases/dto/purchase.dto';
import type { PaymentMethodValue } from '../../purchases/dto/purchase.dto';
import { SaleLineDto } from './sale-line.dto';

const LINES = 'Une facture comporte au moins une ligne';
const CUSTOMER = 'Le client est requis';
const NOTE = 'La note est invalide';
const AMOUNT = 'Le montant doit être un nombre positif (2 décimales au plus)';

export class InvoiceQueryDto extends ListQueryDto {
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

/** A payment collected when the invoice is issued (comptant or partial). */
export class IssuePaymentDto {
  @ApiProperty({ minimum: 0.01 })
  @IsNumber({ maxDecimalPlaces: 2 }, { message: AMOUNT })
  @Min(0.01, { message: AMOUNT })
  @Max(MAX_PAYMENT, { message: 'Le montant est trop élevé' })
  amount!: number;

  @ApiProperty({ enum: PAYMENT_METHODS })
  @IsEnum(PAYMENT_METHODS, { message: 'Le mode de paiement est invalide' })
  method!: PaymentMethodValue;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Trim()
  @IsString({ message: 'La référence est invalide' })
  @MaxLength(100, { message: 'La référence est trop longue' })
  reference?: string | null;
}

export class CreateInvoiceDto {
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
    description:
      'Not before `date`; left out, it defaults to `date` + `invoiceDueDays` at issue',
  })
  @IsOptional()
  @IsDay()
  dueDate?: string | null;

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

/** Create and issue in one go; the optional payment is collected at the invoice date. */
export class CreateIssuedInvoiceDto extends CreateInvoiceDto {
  @ApiPropertyOptional({ type: IssuePaymentDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => IssuePaymentDto)
  payment?: IssuePaymentDto;
}

export class IssueInvoiceDto {
  @ApiPropertyOptional({ type: IssuePaymentDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => IssuePaymentDto)
  payment?: IssuePaymentDto;
}

/** Only a draft can be edited; `lines` replaces the whole list. */
export class UpdateInvoiceDto {
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
  dueDate?: string | null;

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

export class CancelInvoiceDto {
  @ApiProperty()
  @Trim()
  @IsString({ message: "Le motif de l'annulation est requis" })
  @IsNotEmpty({ message: "Le motif de l'annulation est requis" })
  @MaxLength(500, { message: 'Le motif est trop long' })
  reason!: string;
}
