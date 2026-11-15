import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { AnimalCategory, AnimalSex } from '../../generated/prisma/enums';
import { IsDay } from '../../herd/dto/is-day';
import { Trim } from '../../listing/list-helpers';
import { ListQueryDto } from '../../listing/list-query.dto';

const TAG = {
  message: 'Le numéro ne peut contenir que des lettres, chiffres, - . et _',
};

export class AnimalListQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ enum: AnimalSex })
  @IsOptional()
  @IsEnum(AnimalSex, { message: 'Sexe invalide (F ou M)' })
  sex?: AnimalSex;

  @ApiPropertyOptional({ enum: AnimalCategory })
  @IsOptional()
  @IsEnum(AnimalCategory, { message: "Catégorie d'animal invalide" })
  category?: AnimalCategory;
}

export class CreateAnimalDto {
  @ApiProperty({ enum: AnimalCategory })
  @IsEnum(AnimalCategory, { message: "Catégorie d'animal invalide" })
  category!: AnimalCategory;

  @ApiPropertyOptional({
    enum: AnimalSex,
    description: 'Déduit de la catégorie quand absent',
  })
  @IsOptional()
  @IsEnum(AnimalSex, { message: 'Sexe invalide (F ou M)' })
  sex?: AnimalSex;

  @ApiPropertyOptional({ description: 'Généré (TR-001...) quand absent' })
  @IsOptional()
  @Trim()
  @IsString({ message: 'Le numéro est invalide' })
  @IsNotEmpty({ message: 'Le numéro est invalide' })
  @MaxLength(40, { message: 'Le numéro est trop long (40 caractères maximum)' })
  @Matches(/^[\w.-]+$/, TAG)
  tag?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'La race est invalide' })
  @IsNotEmpty({ message: 'La race est invalide' })
  breedId?: string;

  @ApiProperty()
  @IsString({ message: 'Le bâtiment est requis' })
  @IsNotEmpty({ message: 'Le bâtiment est requis' })
  buildingId!: string;

  @ApiPropertyOptional({ example: '2025-01-10' })
  @IsOptional()
  @IsDay()
  birthDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'Le père est invalide' })
  @IsNotEmpty({ message: 'Le père est invalide' })
  sireId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'La mère est invalide' })
  @IsNotEmpty({ message: 'La mère est invalide' })
  damId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Trim()
  @IsString({ message: 'Les notes sont invalides' })
  @MaxLength(2000, { message: 'Les notes sont trop longues' })
  notes?: string;
}

/** Category, sex and status never change through a PATCH (status moves with breeding and the exit route). */
export class UpdateAnimalDto {
  @ApiPropertyOptional()
  @ValidateIf((o: UpdateAnimalDto) => o.tag !== undefined)
  @Trim()
  @IsString({ message: 'Le numéro est invalide' })
  @IsNotEmpty({ message: 'Le numéro est invalide' })
  @MaxLength(40, { message: 'Le numéro est trop long (40 caractères maximum)' })
  @Matches(/^[\w.-]+$/, TAG)
  tag?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString({ message: 'La race est invalide' })
  @IsNotEmpty({ message: 'La race est invalide' })
  breedId?: string | null;

  @ApiPropertyOptional()
  @ValidateIf((o: UpdateAnimalDto) => o.buildingId !== undefined)
  @IsString({ message: 'Le bâtiment est invalide' })
  @IsNotEmpty({ message: 'Le bâtiment est invalide' })
  buildingId?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsDay()
  birthDate?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString({ message: 'Le père est invalide' })
  @IsNotEmpty({ message: 'Le père est invalide' })
  sireId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString({ message: 'La mère est invalide' })
  @IsNotEmpty({ message: 'La mère est invalide' })
  damId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Trim()
  @IsString({ message: 'Les notes sont invalides' })
  @MaxLength(2000, { message: 'Les notes sont trop longues' })
  notes?: string | null;
}

export const EXIT_REASONS = ['VENDU', 'MORT', 'REFORME'] as const;
export type ExitReason = (typeof EXIT_REASONS)[number];

export class ExitAnimalDto {
  @ApiProperty({ example: '2026-11-02' })
  @IsDay()
  date!: string;

  @ApiProperty({ enum: EXIT_REASONS })
  @IsIn(EXIT_REASONS, { message: 'Motif de sortie invalide' })
  reason!: ExitReason;
}

const WEIGHT = 'Le poids doit être un nombre de kg supérieur à 0 (1 décimale)';

export class CreateAnimalWeighingDto {
  @ApiProperty({ example: '2026-11-02' })
  @IsDay()
  date!: string;

  @ApiProperty({ minimum: 0.1, description: 'kg, une décimale' })
  @IsNumber({ maxDecimalPlaces: 1 }, { message: WEIGHT })
  @Min(0.1, { message: WEIGHT })
  @Max(9999.9, { message: 'Le poids est trop élevé' })
  weightKg!: number;
}

export class UpdateAnimalWeighingDto {
  @ApiPropertyOptional({ example: '2026-11-02' })
  @IsOptional()
  @IsDay()
  date?: string;

  @ApiPropertyOptional({ minimum: 0.1, description: 'kg, une décimale' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 1 }, { message: WEIGHT })
  @Min(0.1, { message: WEIGHT })
  @Max(9999.9, { message: 'Le poids est trop élevé' })
  weightKg?: number;
}

export class HerdListQueryDto extends ListQueryDto {
  @ApiPropertyOptional({
    description: 'Truie, Verrat, Cochette, Porcelets, Engraissement',
  })
  @IsOptional()
  @IsString({ message: 'Catégorie invalide' })
  category?: string;
}
