import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { Species } from '../../generated/prisma/enums';
import { Trim } from '../../listing/list-helpers';

const NAME = 'Le nom est requis';

export class BreedQueryDto {
  @ApiPropertyOptional({ enum: Species })
  @IsOptional()
  @IsEnum(Species, { message: 'Espèce invalide (AVICOLE ou PORCIN)' })
  species?: Species;
}

export class CreateBreedDto {
  @ApiProperty()
  @Trim()
  @IsString({ message: NAME })
  @IsNotEmpty({ message: NAME })
  @MaxLength(100, { message: 'Le nom est trop long (100 caractères maximum)' })
  name!: string;

  @ApiProperty({ enum: Species })
  @IsEnum(Species, { message: 'Espèce invalide (AVICOLE ou PORCIN)' })
  species!: Species;
}

export class UpdateBreedDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Trim()
  @IsString({ message: NAME })
  @IsNotEmpty({ message: NAME })
  @MaxLength(100, { message: 'Le nom est trop long (100 caractères maximum)' })
  name?: string;
}
