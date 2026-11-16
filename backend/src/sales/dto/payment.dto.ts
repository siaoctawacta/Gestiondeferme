import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { MAX_PAYMENT } from '../../common/limits';
import { CustomerPaymentKind } from '../../generated/prisma/enums';
import { IsDay } from '../../herd/dto/is-day';
import { Trim } from '../../listing/list-helpers';
import { PAYMENT_METHODS } from '../../purchases/dto/purchase.dto';
import type { PaymentMethodValue } from '../../purchases/dto/purchase.dto';

const AMOUNT = 'Le montant doit être un nombre positif (2 décimales au plus)';

/** An encashment of a client invoice, or (`kind: REMBOURSEMENT`) the refund of what a credit note left owed back. */
export class CreateClientPaymentDto {
  @ApiProperty({ example: '2026-11-02' })
  @IsDay()
  date!: string;

  @ApiProperty({
    minimum: 0.01,
    description: 'At most what is due (encashment) or owed back (refund)',
  })
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

  @ApiPropertyOptional({
    enum: CustomerPaymentKind,
    default: 'ENCAISSEMENT',
    description: 'REMBOURSEMENT: giving back what a credit note left owed',
  })
  @ValidateIf((_o, v) => v !== undefined)
  @IsEnum(CustomerPaymentKind, { message: 'Le type de paiement est invalide' })
  kind?: CustomerPaymentKind;
}
