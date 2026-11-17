import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { CustomerPaymentKind } from '../../generated/prisma/enums';
import { IsDay } from '../../herd/dto/is-day';
import { ListQueryDto } from '../../listing/list-query.dto';
import { PAYMENT_METHODS } from '../../purchases/dto/purchase.dto';
import type { PaymentMethodValue } from '../../purchases/dto/purchase.dto';

export class PaymentsJournalQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ example: '2026-11-01' })
  @IsOptional()
  @IsDay()
  from?: string;

  @ApiPropertyOptional({ example: '2026-11-30' })
  @IsOptional()
  @IsDay()
  to?: string;

  @ApiPropertyOptional({ enum: CustomerPaymentKind })
  @IsOptional()
  @IsEnum(CustomerPaymentKind, { message: 'Le type de paiement est invalide' })
  kind?: CustomerPaymentKind;

  @ApiPropertyOptional({ enum: PAYMENT_METHODS })
  @IsOptional()
  @IsEnum(PAYMENT_METHODS, { message: 'Le mode de paiement est invalide' })
  method?: PaymentMethodValue;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'Le client est invalide' })
  customerId?: string;
}
