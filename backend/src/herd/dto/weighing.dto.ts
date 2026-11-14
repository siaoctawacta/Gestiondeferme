import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Trim } from '../../listing/list-helpers';
import { IsDay } from './is-day';

const SAMPLE =
  "La taille de l'échantillon doit être un nombre entier supérieur à 0";
const WEIGHT =
  'Le poids moyen doit être un nombre entier de grammes supérieur à 0';

export class CreateWeighingDto {
  @ApiProperty({ example: '2026-11-02' })
  @IsDay()
  date!: string;

  @ApiProperty({ minimum: 1 })
  @IsInt({ message: SAMPLE })
  @Min(1, { message: SAMPLE })
  @Max(1_000_000, { message: "L'échantillon est trop grand" })
  sampleSize!: number;

  @ApiProperty({ minimum: 1, description: 'grammes' })
  @IsInt({ message: WEIGHT })
  @Min(1, { message: WEIGHT })
  @Max(1_000_000, { message: 'Le poids moyen est trop élevé' })
  averageWeightG!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Trim()
  @IsString({ message: 'La note est invalide' })
  @MaxLength(1000, { message: 'La note est trop longue' })
  note?: string;
}

export class UpdateWeighingDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsDay()
  date?: string;

  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @IsInt({ message: SAMPLE })
  @Min(1, { message: SAMPLE })
  @Max(1_000_000, { message: "L'échantillon est trop grand" })
  sampleSize?: number;

  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @IsInt({ message: WEIGHT })
  @Min(1, { message: WEIGHT })
  @Max(1_000_000, { message: 'Le poids moyen est trop élevé' })
  averageWeightG?: number;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Trim()
  @IsString({ message: 'La note est invalide' })
  @MaxLength(1000, { message: 'La note est trop longue' })
  note?: string | null;
}
