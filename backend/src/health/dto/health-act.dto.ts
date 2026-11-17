import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsIn, IsOptional, IsString } from 'class-validator';
import { IsDay } from '../../herd/dto/is-day';
import { ListQueryDto } from '../../listing/list-query.dto';
import {
  NotNull,
  OptionalDays,
  OptionalDay,
  OptionalId,
  OptionalQuantity,
  OptionalText,
} from '../../common/dto-fields';

export const ACT_TYPES = [
  'VACCINATION',
  'TRAITEMENT',
  'DESINFECTION',
  'DIAGNOSTIC',
] as const;
export type ActTypeValue = (typeof ACT_TYPES)[number];
const TYPE = "Le type d'intervention est invalide";

export class HealthActQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ enum: ACT_TYPES })
  @IsOptional()
  @IsEnum(ACT_TYPES, { message: TYPE })
  type?: ActTypeValue;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'Le lot est invalide' })
  batchId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: "L'animal est invalide" })
  animalId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'Le bâtiment est invalide' })
  buildingId?: string;

  @ApiPropertyOptional({ example: '2026-11-01' })
  @IsOptional()
  @IsDay()
  from?: string;

  @ApiPropertyOptional({ example: '2026-11-30' })
  @IsOptional()
  @IsDay()
  to?: string;
}

export class CreateHealthActDto {
  @ApiProperty({ enum: ACT_TYPES })
  @IsEnum(ACT_TYPES, { message: TYPE })
  type!: ActTypeValue;

  @ApiPropertyOptional({ enum: ['PLANIFIE', 'REALISE'], default: 'PLANIFIE' })
  @IsOptional()
  @IsIn(['PLANIFIE', 'REALISE'], { message: 'Le statut est invalide' })
  status?: 'PLANIFIE' | 'REALISE';

  @ApiProperty({
    example: '2026-11-02',
    description:
      'Date prévue, ou jour de réalisation pour un acte saisi réalisé',
  })
  @IsDay()
  date!: string;

  @ApiPropertyOptional({
    description: 'Acte réalisé : jour de réalisation (défaut : date)',
  })
  @OptionalDay()
  doneDate?: string;

  @ApiPropertyOptional({
    description:
      'Une seule cible : lot ou animal (bâtiment pour une désinfection)',
  })
  @OptionalId()
  batchId?: string;

  @OptionalId()
  animalId?: string;

  @OptionalId()
  buildingId?: string;

  @ApiPropertyOptional({ description: 'Produit vétérinaire en stock' })
  @OptionalId()
  stockItemId?: string;

  @ApiPropertyOptional({
    description: 'Lot de produit (sinon le plus proche de sa péremption)',
  })
  @OptionalId()
  stockBatchId?: string;

  @OptionalText(120, 'Le produit')
  productName?: string;

  @OptionalText(60, 'La dose')
  dose?: string;

  @OptionalQuantity()
  quantity?: number;

  @OptionalDays()
  durationDays?: number;

  @OptionalDays()
  withdrawalDays?: number;

  @OptionalText(120, 'Le vétérinaire')
  veterinarian?: string;

  @OptionalText(1000, 'Les symptômes')
  symptoms?: string;

  @OptionalText(1000, 'Le diagnostic')
  diagnosis?: string;

  @OptionalText(1000, 'La note')
  note?: string;
}

/** The type and the target of an act never change: delete and recreate it. */
export class UpdateHealthActDto {
  @ApiPropertyOptional()
  @NotNull()
  @IsDay()
  date?: string;

  @ApiPropertyOptional({ description: 'Acte réalisé seulement' })
  @NotNull()
  @IsDay()
  doneDate?: string;

  @ApiPropertyOptional({ description: 'Acte planifié seulement' })
  @OptionalId()
  stockItemId?: string | null;

  @OptionalId()
  stockBatchId?: string | null;

  @OptionalText(120, 'Le produit')
  productName?: string | null;

  @OptionalText(60, 'La dose')
  dose?: string | null;

  @OptionalQuantity()
  quantity?: number | null;

  @OptionalDays()
  durationDays?: number | null;

  @OptionalDays()
  withdrawalDays?: number | null;

  @OptionalText(120, 'Le vétérinaire')
  veterinarian?: string | null;

  @OptionalText(1000, 'Les symptômes')
  symptoms?: string | null;

  @OptionalText(1000, 'Le diagnostic')
  diagnosis?: string | null;

  @OptionalText(1000, 'La note')
  note?: string | null;
}

export class CompleteHealthActDto {
  @ApiProperty({ example: '2026-11-02' })
  @IsDay()
  doneDate!: string;

  @OptionalQuantity()
  quantity?: number;

  @ApiPropertyOptional({
    description: 'Produit en stock, si l’acte planifié n’en avait pas',
  })
  @OptionalId()
  stockItemId?: string;

  @OptionalId()
  stockBatchId?: string;
}
