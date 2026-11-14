import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { Trim } from '../shared';

export class CreateFarmDto {
  @ApiProperty()
  @Trim()
  @IsString({ message: 'Le nom est requis' })
  @IsNotEmpty({ message: 'Le nom est requis' })
  @MaxLength(100, { message: 'Le nom est trop long (100 caractères maximum)' })
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Trim()
  @IsString({ message: 'Le lieu est invalide' })
  @MaxLength(200, { message: 'Le lieu est trop long (200 caractères maximum)' })
  location?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean({ message: 'Le statut actif est invalide' })
  active?: boolean;
}

export class UpdateFarmDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Trim()
  @IsString({ message: 'Le nom est requis' })
  @IsNotEmpty({ message: 'Le nom est requis' })
  @MaxLength(100, { message: 'Le nom est trop long (100 caractères maximum)' })
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Trim()
  @IsString({ message: 'Le lieu est invalide' })
  @MaxLength(200, { message: 'Le lieu est trop long (200 caractères maximum)' })
  location?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean({ message: 'Le statut actif est invalide' })
  active?: boolean;
}
