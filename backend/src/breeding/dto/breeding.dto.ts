import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { BreedingMethod } from '../../generated/prisma/enums';
import { IsDay } from '../../herd/dto/is-day';
import { Trim } from '../../listing/list-helpers';
import { ListQueryDto } from '../../listing/list-query.dto';

const COUNT = 'Le nombre doit être un nombre entier positif ou nul';
const MAX_COUNT = 100;

export class BreedingListQueryDto extends ListQueryDto {}

export class CreateBreedingDto {
  @ApiProperty()
  @IsString({ message: 'La truie est requise' })
  @IsNotEmpty({ message: 'La truie est requise' })
  sowId!: string;

  @ApiProperty({ enum: BreedingMethod })
  @IsEnum(BreedingMethod, { message: 'Méthode invalide (SAILLIE ou IA)' })
  method!: BreedingMethod;

  @ApiPropertyOptional({ description: 'Verrat actif (saillie)' })
  @IsOptional()
  @IsString({ message: 'Le verrat est invalide' })
  @IsNotEmpty({ message: 'Le verrat est invalide' })
  boarId?: string;

  @ApiPropertyOptional({ description: 'Libellé de la semence (IA)' })
  @IsOptional()
  @Trim()
  @IsString({ message: 'La semence est invalide' })
  @IsNotEmpty({ message: 'La semence est invalide' })
  @MaxLength(100, { message: 'Le libellé de la semence est trop long' })
  semenLabel?: string;

  @ApiProperty({ example: '2026-07-05' })
  @IsDay()
  serviceDate!: string;
}

export class UpdateBreedingDto {
  @ApiProperty({ example: '2026-07-05' })
  @IsDay()
  serviceDate!: string;
}

export class FarrowingDto {
  @ApiProperty({ example: '2026-10-27' })
  @IsDay()
  date!: string;

  @ApiProperty({ minimum: 0 })
  @IsInt({ message: COUNT })
  @Min(0, { message: COUNT })
  @Max(MAX_COUNT, { message: 'Le nombre de porcelets est trop élevé' })
  bornTotal!: number;

  @ApiProperty({ minimum: 0 })
  @IsInt({ message: COUNT })
  @Min(0, { message: COUNT })
  @Max(MAX_COUNT, { message: 'Le nombre de porcelets est trop élevé' })
  bornAlive!: number;

  @ApiProperty({ minimum: 0 })
  @IsInt({ message: COUNT })
  @Min(0, { message: COUNT })
  @Max(MAX_COUNT, { message: 'Le nombre de porcelets est trop élevé' })
  stillborn!: number;

  @ApiPropertyOptional({
    description:
      'Bâtiment de la portée (requis quand des porcelets naissent vivants)',
  })
  @IsOptional()
  @IsString({ message: 'Le bâtiment est invalide' })
  @IsNotEmpty({ message: 'Le bâtiment est invalide' })
  buildingId?: string;
}

export class WeaningDto {
  @ApiProperty({ example: '2026-11-20' })
  @IsDay()
  date!: string;

  @ApiProperty({ minimum: 0 })
  @IsInt({ message: COUNT })
  @Min(0, { message: COUNT })
  @Max(MAX_COUNT, { message: 'Le nombre de porcelets est trop élevé' })
  weanedCount!: number;
}

export class FailBreedingDto {
  @ApiProperty({ example: '2026-08-05' })
  @IsDay()
  date!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Trim()
  @IsString({ message: 'La note est invalide' })
  @MaxLength(1000, { message: 'La note est trop longue' })
  note?: string;
}

export class UpdateHeatDto {
  @ApiPropertyOptional({ example: '2026-11-02' })
  @IsOptional()
  @IsDay()
  date?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Trim()
  @IsString({ message: 'La note est invalide' })
  @MaxLength(1000, { message: 'La note est trop longue' })
  note?: string | null;
}

export class CreateHeatDto {
  @ApiProperty({ example: '2026-11-02' })
  @IsDay()
  date!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Trim()
  @IsString({ message: 'La note est invalide' })
  @MaxLength(1000, { message: 'La note est trop longue' })
  note?: string;
}
