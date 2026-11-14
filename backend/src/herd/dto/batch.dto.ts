import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { BatchType, Species } from '../../generated/prisma/enums';
import { ListQueryDto } from '../../listing/list-query.dto';
import { Trim } from '../../listing/list-helpers';
import { IsDay } from './is-day';

const COUNT = "L'effectif doit être un nombre entier supérieur à 0";
const MAX_COUNT = 10_000_000;

export class BatchListQueryDto extends ListQueryDto {
  @ApiProperty({ enum: Species })
  @IsEnum(Species, { message: "L'espèce est requise (AVICOLE ou PORCIN)" })
  species!: Species;

  @ApiPropertyOptional({ enum: BatchType })
  @IsOptional()
  @IsEnum(BatchType, { message: 'Type de lot invalide' })
  type?: BatchType;
}

export class CreateBatchDto {
  @ApiProperty({ enum: Species })
  @IsEnum(Species, { message: "L'espèce est requise (AVICOLE ou PORCIN)" })
  species!: Species;

  @ApiProperty({ enum: BatchType })
  @IsEnum(BatchType, { message: 'Type de lot invalide' })
  type!: BatchType;

  @ApiPropertyOptional({ description: 'Généré (LC-2026-01...) quand absent' })
  @IsOptional()
  @Trim()
  @IsString({ message: 'Le code est invalide' })
  @IsNotEmpty({ message: 'Le code est invalide' })
  @MaxLength(40, { message: 'Le code est trop long (40 caractères maximum)' })
  @Matches(/^[\w.-]+$/, {
    message: 'Le code ne peut contenir que des lettres, chiffres, - . et _',
  })
  code?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'La souche est invalide' })
  @IsNotEmpty({ message: 'La souche est invalide' })
  breedId?: string;

  @ApiProperty()
  @IsString({ message: 'Le bâtiment est requis' })
  @IsNotEmpty({ message: 'Le bâtiment est requis' })
  buildingId!: string;

  @ApiProperty({ example: '2026-10-01' })
  @IsDay()
  entryDate!: string;

  @ApiProperty({ minimum: 1 })
  @IsInt({ message: COUNT })
  @Min(1, { message: COUNT })
  @Max(MAX_COUNT, { message: "L'effectif est trop élevé" })
  initialCount!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Trim()
  @IsString({ message: 'Le fournisseur est invalide' })
  @MaxLength(100, { message: 'Le fournisseur est trop long' })
  supplierName?: string;

  @ApiPropertyOptional({ description: 'FCFA' })
  @IsOptional()
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: "Le prix d'achat est invalide" },
  )
  @Min(0, { message: "Le prix d'achat est invalide" })
  @Max(1_000_000_000_000, { message: "Le prix d'achat est trop élevé" })
  purchasePrice?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'Le responsable est invalide' })
  @IsNotEmpty({ message: 'Le responsable est invalide' })
  responsibleId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Trim()
  @IsString({ message: 'Les notes sont invalides' })
  @MaxLength(2000, { message: 'Les notes sont trop longues' })
  notes?: string;
}

/** `buildingId` is accepted only to be refused with a clear message: housing changes go through the transfer. */
export class UpdateBatchDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'Le bâtiment est invalide' })
  buildingId?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString({ message: 'La souche est invalide' })
  breedId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDay()
  entryDate?: string;

  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @IsInt({ message: COUNT })
  @Min(1, { message: COUNT })
  @Max(MAX_COUNT, { message: "L'effectif est trop élevé" })
  initialCount?: number;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Trim()
  @IsString({ message: 'Le fournisseur est invalide' })
  @MaxLength(100, { message: 'Le fournisseur est trop long' })
  supplierName?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: "Le prix d'achat est invalide" },
  )
  @Min(0, { message: "Le prix d'achat est invalide" })
  @Max(1_000_000_000_000, { message: "Le prix d'achat est trop élevé" })
  purchasePrice?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString({ message: 'Le responsable est invalide' })
  responsibleId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Trim()
  @IsString({ message: 'Les notes sont invalides' })
  @MaxLength(2000, { message: 'Les notes sont trop longues' })
  notes?: string | null;
}
