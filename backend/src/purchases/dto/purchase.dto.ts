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
import {
  MAX_LINES,
  MAX_PAYMENT,
  MAX_PRICE,
  MAX_QUANTITY,
} from '../../common/limits';
import { Activity } from '../../generated/prisma/enums';
import { IsDay } from '../../herd/dto/is-day';
import { Trim } from '../../listing/list-helpers';
import { ListQueryDto } from '../../listing/list-query.dto';

export const PAYMENT_METHODS = [
  'ESPECES',
  'VIREMENT',
  'MOBILE_MONEY',
  'CHEQUE',
] as const;
export type PaymentMethodValue = (typeof PAYMENT_METHODS)[number];

const ACTIVITY = "L'activité est invalide";
const QTY = 'La quantité doit être un nombre positif (2 décimales au plus)';
const RECEIVED =
  'La quantité reçue doit être un nombre positif ou nul (2 décimales au plus)';
const PRICE =
  'Le prix unitaire doit être un nombre positif ou nul (2 décimales au plus)';
const AMOUNT = 'Le montant doit être un nombre positif (2 décimales au plus)';
const ID = 'Identifiant invalide';
const NOTE = 'La note est invalide';
const LINES = 'Une demande comporte au moins une ligne';

export class PurchaseQueryDto extends ListQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'Le fournisseur est invalide' })
  supplierId?: string;
}

export class PurchaseLineDto {
  @ApiProperty({ description: 'Stock item id' })
  @IsString({ message: ID })
  @IsNotEmpty({ message: ID })
  itemId!: string;

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
}

export class CreatePurchaseDto {
  @ApiProperty()
  @IsString({ message: 'Le fournisseur est requis' })
  @IsNotEmpty({ message: 'Le fournisseur est requis' })
  supplierId!: string;

  @ApiProperty({ example: '2026-11-02' })
  @IsDay()
  date!: string;

  @ApiProperty({ type: [PurchaseLineDto] })
  @IsArray({ message: LINES })
  @ArrayMinSize(1, { message: LINES })
  @ArrayMaxSize(MAX_LINES, { message: 'Trop de lignes' })
  @ValidateNested({ each: true })
  @Type(() => PurchaseLineDto)
  lines!: PurchaseLineDto[];

  @ApiPropertyOptional({ enum: Activity, default: 'GENERAL' })
  @ValidateIf((_o, v) => v !== undefined)
  @IsEnum(Activity, { message: ACTIVITY })
  activity?: Activity;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Trim()
  @IsString({ message: NOTE })
  @MaxLength(1000, { message: 'La note est trop longue' })
  note?: string | null;
}

/** Only a request (`DEMANDE`) can be edited; `lines` replaces the whole list. */
export class UpdatePurchaseDto {
  @ApiPropertyOptional()
  @ValidateIf((_o, v) => v !== undefined)
  @IsString({ message: 'Le fournisseur est invalide' })
  @IsNotEmpty({ message: 'Le fournisseur est invalide' })
  supplierId?: string;

  @ApiPropertyOptional()
  @ValidateIf((_o, v) => v !== undefined)
  @IsDay()
  date?: string;

  @ApiPropertyOptional({ type: [PurchaseLineDto] })
  @ValidateIf((_o, v) => v !== undefined)
  @IsArray({ message: LINES })
  @ArrayMinSize(1, { message: LINES })
  @ArrayMaxSize(MAX_LINES, { message: 'Trop de lignes' })
  @ValidateNested({ each: true })
  @Type(() => PurchaseLineDto)
  lines?: PurchaseLineDto[];

  @ApiPropertyOptional({ enum: Activity })
  @ValidateIf((_o, v) => v !== undefined)
  @IsEnum(Activity, { message: ACTIVITY })
  activity?: Activity;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Trim()
  @IsString({ message: NOTE })
  @MaxLength(1000, { message: 'La note est trop longue' })
  note?: string | null;
}

export class ReceiveLineDto {
  @ApiProperty({
    description:
      'Stock item id of an ordered line. An article ordered on several lines appears as many times, in the order of the lines.',
  })
  @IsString({ message: ID })
  @IsNotEmpty({ message: ID })
  itemId!: string;

  @ApiProperty({
    minimum: 0,
    description:
      'May differ from the ordered quantity. 0 creates no lot and no movement.',
  })
  @IsNumber({ maxDecimalPlaces: 2 }, { message: RECEIVED })
  @Min(0, { message: RECEIVED })
  @Max(MAX_QUANTITY, { message: 'La quantité est trop élevée' })
  receivedQuantity!: number;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Trim()
  @IsString({ message: 'Le numéro de lot est invalide' })
  @MaxLength(60, { message: 'Le numéro de lot est trop long' })
  lotNumber?: string | null;

  @ApiPropertyOptional({ nullable: true, example: '2027-06-30' })
  @IsOptional()
  @IsDay()
  expiryDate?: string | null;
}

/**
 * Receives an ordered purchase: one entry per line of the order (each line
 * gets its own lot at the order's unit price, in one stock operation).
 */
export class ReceivePurchaseDto {
  @ApiProperty({
    example: '2026-11-02',
    description:
      "Not in the future, and not before the purchase's own `date` (the date of the document, not the day its BC number was assigned)",
  })
  @IsDay()
  date!: string;

  @ApiProperty({ type: [ReceiveLineDto] })
  @IsArray({ message: LINES })
  @ArrayMinSize(1, { message: LINES })
  @ArrayMaxSize(MAX_LINES, { message: 'Trop de lignes' })
  @ValidateNested({ each: true })
  @Type(() => ReceiveLineDto)
  lines!: ReceiveLineDto[];
}

export class CancelPurchaseDto {
  @ApiProperty()
  @Trim()
  @IsString({ message: "Le motif de l'annulation est requis" })
  @IsNotEmpty({ message: "Le motif de l'annulation est requis" })
  @MaxLength(500, { message: 'Le motif est trop long' })
  reason!: string;
}

export class CreatePaymentDto {
  @ApiProperty({ example: '2026-11-02' })
  @IsDay()
  date!: string;

  @ApiProperty({ minimum: 0.01, description: 'At most the remaining amount' })
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
