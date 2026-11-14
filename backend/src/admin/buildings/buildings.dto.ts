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
import { BuildingStatus, BuildingType } from '../../generated/prisma/enums';
import { Trim } from '../../listing/list-helpers';

const NAME = 'Le nom est requis';
const CAPACITY_MIN = 'La capacité doit être supérieure à 0';

export class CreateBuildingDto {
  @ApiProperty()
  @Trim()
  @IsString({ message: NAME })
  @IsNotEmpty({ message: NAME })
  @MaxLength(100, { message: 'Le nom est trop long (100 caractères maximum)' })
  name!: string;

  @ApiProperty({ enum: BuildingType })
  @IsEnum(BuildingType, { message: 'Type de bâtiment invalide' })
  type!: BuildingType;

  @ApiProperty()
  @IsString({ message: 'Le site est requis' })
  @IsNotEmpty({ message: 'Le site est requis' })
  siteId!: string;

  @ApiProperty({ minimum: 1 })
  @IsInt({ message: 'La capacité doit être un nombre entier' })
  @Min(1, { message: CAPACITY_MIN })
  @Max(10_000_000, { message: 'La capacité est trop élevée' })
  capacity!: number;

  @ApiPropertyOptional({ enum: BuildingStatus })
  @IsOptional()
  @IsEnum(BuildingStatus, { message: 'Statut de bâtiment invalide' })
  status?: BuildingStatus;
}

export class UpdateBuildingDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Trim()
  @IsString({ message: NAME })
  @IsNotEmpty({ message: NAME })
  @MaxLength(100, { message: 'Le nom est trop long (100 caractères maximum)' })
  name?: string;

  @ApiPropertyOptional({ enum: BuildingType })
  @IsOptional()
  @IsEnum(BuildingType, { message: 'Type de bâtiment invalide' })
  type?: BuildingType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'Le site est invalide' })
  @IsNotEmpty({ message: 'Le site est invalide' })
  siteId?: string;

  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @IsInt({ message: 'La capacité doit être un nombre entier' })
  @Min(1, { message: CAPACITY_MIN })
  @Max(10_000_000, { message: 'La capacité est trop élevée' })
  capacity?: number;

  @ApiPropertyOptional({ enum: BuildingStatus })
  @IsOptional()
  @IsEnum(BuildingStatus, { message: 'Statut de bâtiment invalide' })
  status?: BuildingStatus;
}
