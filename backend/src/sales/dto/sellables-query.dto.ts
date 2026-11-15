import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString } from 'class-validator';
import { IsDay } from '../../herd/dto/is-day';

/** The kinds of line that name a source (a service names none). */
export const SELLABLE_KINDS = ['LOT', 'ANIMAL', 'OEUFS', 'ARTICLE'] as const;
export type SellableKind = (typeof SELLABLE_KINDS)[number];

export class SellablesQueryDto {
  @ApiProperty({ enum: SELLABLE_KINDS })
  @IsString({ message: 'Le type de ligne est invalide' })
  @IsIn(SELLABLE_KINDS, { message: 'Le type de ligne est invalide' })
  kind!: SellableKind;

  @ApiProperty({ example: '2026-11-12', description: 'The date of the sale' })
  @IsDay()
  date!: string;
}
