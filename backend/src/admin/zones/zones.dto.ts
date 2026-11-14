import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ListQueryDto } from '../../listing/list-query.dto';
import { Trim } from '../../listing/list-helpers';

const NAME = 'Le nom est requis';
const CAPACITY_MIN = 'La capacité doit être supérieure à 0';

export class ZonesQueryDto extends ListQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  buildingId?: string;
}

export class CreateZoneDto {
  @ApiProperty()
  @IsString({ message: 'Le bâtiment est requis' })
  @IsNotEmpty({ message: 'Le bâtiment est requis' })
  buildingId!: string;

  @ApiProperty()
  @Trim()
  @IsString({ message: NAME })
  @IsNotEmpty({ message: NAME })
  @MaxLength(100, { message: 'Le nom est trop long (100 caractères maximum)' })
  name!: string;

  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @IsInt({ message: 'La capacité doit être un nombre entier' })
  @Min(1, { message: CAPACITY_MIN })
  @Max(10_000_000, { message: 'La capacité est trop élevée' })
  capacity?: number;
}

export class UpdateZoneDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Trim()
  @IsString({ message: NAME })
  @IsNotEmpty({ message: NAME })
  @MaxLength(100, { message: 'Le nom est trop long (100 caractères maximum)' })
  name?: string;

  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @IsInt({ message: 'La capacité doit être un nombre entier' })
  @Min(1, { message: CAPACITY_MIN })
  @Max(10_000_000, { message: 'La capacité est trop élevée' })
  capacity?: number;
}
