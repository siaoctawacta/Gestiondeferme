import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
} from 'class-validator';
import { IsDay } from '../../herd/dto/is-day';
import { MAX_LITERS } from './feed-distribution.dto';

const WATER =
  "Le volume d'eau doit être un nombre positif (2 décimales au plus)";
const ID = 'Identifiant invalide';

export class CreateWaterDto {
  @ApiPropertyOptional({ description: 'Exactly one of batchId / buildingId' })
  @IsOptional()
  @IsString({ message: ID })
  @IsNotEmpty({ message: ID })
  batchId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: ID })
  @IsNotEmpty({ message: ID })
  buildingId?: string;

  @ApiProperty({ example: '2026-11-02' })
  @IsDay()
  date!: string;

  @ApiProperty({ minimum: 0 })
  @IsNumber({ maxDecimalPlaces: 2 }, { message: WATER })
  @IsPositive({ message: WATER })
  @Max(MAX_LITERS, { message: "Le volume d'eau est trop élevé" })
  liters!: number;
}

export class UpdateWaterDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsDay()
  date?: string;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: WATER })
  @IsPositive({ message: WATER })
  @Max(MAX_LITERS, { message: "Le volume d'eau est trop élevé" })
  liters?: number;
}
